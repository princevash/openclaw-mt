/**
 * Terminal gateway methods for web-based terminal access.
 * OPENCLAWMU ADDITION: tenant-scoped PTY terminal surface.
 *
 * Provides WebSocket terminal sessions for tenant sandboxes.
 *
 * Methods:
 *   terminal.spawn   - Spawn a new terminal session
 *   terminal.write   - Write data to a terminal
 *   terminal.resize  - Resize a terminal
 *   terminal.close   - Close a terminal session
 *   terminal.list    - List active terminal sessions
 */

import crypto from "node:crypto";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { spawnBwrapPtyAuto, type BwrapPtyHandle } from "../../agents/sandbox/bwrap-pty.js";
import { errorShape, ErrorCodes } from "../protocol/index.js";

/**
 * Terminal session storage.
 * Maps terminalId -> session info.
 */
const terminalSessions = new Map<
  string,
  {
    terminalId: string;
    tenantId: string;
    connId: string;
    pty: BwrapPtyHandle;
    createdAt: number;
    lastActivityAt: number;
  }
>();

/**
 * Max idle time before terminal is cleaned up (5 minutes).
 */
const TERMINAL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Cleanup idle terminals periodically.
 */
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanupInterval() {
  if (cleanupInterval) {
    return;
  }
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [terminalId, session] of terminalSessions) {
      if (now - session.lastActivityAt > TERMINAL_IDLE_TIMEOUT_MS) {
        try {
          session.pty.kill();
        } catch {
          // ignore
        }
        terminalSessions.delete(terminalId);
      }
    }
  }, 60_000); // Check every minute
}

/**
 * Gets the tenant ID from the client connection.
 */
function getTenantId(opts: GatewayRequestHandlerOptions): string | null {
  return opts.client?.tenantId ?? null;
}

/**
 * Checks if the client has admin scope.
 */
function hasAdminScope(opts: GatewayRequestHandlerOptions): boolean {
  const scopes = opts.client?.connect?.scopes ?? [];
  return scopes.includes("operator.admin");
}

/**
 * Terminal gateway method handlers.
 */
export const terminalMethods: GatewayRequestHandlers = {
  /**
   * Spawns a new terminal session in the tenant's sandbox.
   */
  "terminal.spawn": async (opts) => {
    const tenantId = getTenantId(opts);
    if (!tenantId) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAUTHORIZED, "Tenant authentication required for terminal access"),
      );
      return;
    }

    const connId = opts.client?.connId;
    if (!connId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Connection ID required"));
      return;
    }

    const params = opts.params as {
      cols?: number;
      rows?: number;
      shell?: string;
      env?: Record<string, string>;
    };

    const cols = typeof params.cols === "number" ? Math.max(10, Math.min(500, params.cols)) : 80;
    const rows = typeof params.rows === "number" ? Math.max(5, Math.min(200, params.rows)) : 24;
    const shell = params.shell ?? "/bin/bash";

    try {
      const pty = await spawnBwrapPtyAuto({
        tenantId,
        shell,
        cols,
        rows,
        env: params.env,
      });

      const terminalId = crypto.randomUUID();
      const now = Date.now();

      // Store the session
      terminalSessions.set(terminalId, {
        terminalId,
        tenantId,
        connId,
        pty,
        createdAt: now,
        lastActivityAt: now,
      });

      // Start cleanup interval if not running
      startCleanupInterval();

      // Set up data forwarding to client via broadcast
      pty.onData((data) => {
        const session = terminalSessions.get(terminalId);
        if (session) {
          session.lastActivityAt = Date.now();
          // Broadcast terminal output to the client
          opts.context.broadcastToConnIds(
            "terminal.output",
            { terminalId, data },
            new Set([connId]),
          );
        }
      });

      // Handle exit
      pty.onExit((code, signal) => {
        const session = terminalSessions.get(terminalId);
        if (session) {
          opts.context.broadcastToConnIds(
            "terminal.exit",
            { terminalId, exitCode: code, signal },
            new Set([connId]),
          );
          terminalSessions.delete(terminalId);
        }
      });

      opts.respond(true, {
        terminalId,
        pid: pty.pid,
        cols,
        rows,
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `Failed to spawn terminal: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  },

  /**
   * Writes data to a terminal session.
   */
  "terminal.write": async (opts) => {
    const tenantId = getTenantId(opts);
    const isAdmin = hasAdminScope(opts);

    const params = opts.params as { terminalId?: string; data?: string };

    if (!params.terminalId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "terminalId required"));
      return;
    }

    if (typeof params.data !== "string") {
      opts.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "data required"));
      return;
    }

    const session = terminalSessions.get(params.terminalId);
    if (!session) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_FOUND, "Terminal session not found"),
      );
      return;
    }

    // Check access: must be owner tenant or admin
    if (!isAdmin && session.tenantId !== tenantId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      session.pty.write(params.data);
      session.lastActivityAt = Date.now();
      opts.respond(true, { written: params.data.length });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `Failed to write to terminal: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  },

  /**
   * Resizes a terminal session.
   */
  "terminal.resize": async (opts) => {
    const tenantId = getTenantId(opts);
    const isAdmin = hasAdminScope(opts);

    const params = opts.params as { terminalId?: string; cols?: number; rows?: number };

    if (!params.terminalId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "terminalId required"));
      return;
    }

    const cols = typeof params.cols === "number" ? Math.max(10, Math.min(500, params.cols)) : null;
    const rows = typeof params.rows === "number" ? Math.max(5, Math.min(200, params.rows)) : null;

    if (cols === null || rows === null) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "cols and rows required"),
      );
      return;
    }

    const session = terminalSessions.get(params.terminalId);
    if (!session) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_FOUND, "Terminal session not found"),
      );
      return;
    }

    // Check access
    if (!isAdmin && session.tenantId !== tenantId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      session.pty.resize(cols, rows);
      session.lastActivityAt = Date.now();
      opts.respond(true, { cols, rows });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `Failed to resize terminal: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  },

  /**
   * Closes a terminal session.
   */
  "terminal.close": async (opts) => {
    const tenantId = getTenantId(opts);
    const isAdmin = hasAdminScope(opts);

    const params = opts.params as { terminalId?: string };

    if (!params.terminalId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "terminalId required"));
      return;
    }

    const session = terminalSessions.get(params.terminalId);
    if (!session) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_FOUND, "Terminal session not found"),
      );
      return;
    }

    // Check access
    if (!isAdmin && session.tenantId !== tenantId) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      session.pty.kill();
      terminalSessions.delete(params.terminalId);
      opts.respond(true, { closed: true });
    } catch (err) {
      // Still remove from map
      terminalSessions.delete(params.terminalId);
      opts.respond(true, { closed: true, warning: String(err) });
    }
  },

  /**
   * Lists active terminal sessions for the current tenant.
   */
  "terminal.list": async (opts) => {
    const tenantId = getTenantId(opts);
    const isAdmin = hasAdminScope(opts);

    const sessions: Array<{
      terminalId: string;
      tenantId: string;
      pid: number;
      createdAt: number;
      lastActivityAt: number;
    }> = [];

    for (const session of terminalSessions.values()) {
      // Admin sees all, tenant sees own
      if (isAdmin || session.tenantId === tenantId) {
        sessions.push({
          terminalId: session.terminalId,
          tenantId: session.tenantId,
          pid: session.pty.pid,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
        });
      }
    }

    opts.respond(true, { sessions });
  },
};

/**
 * List of terminal method names for registration.
 */
export const TERMINAL_METHODS = Object.keys(terminalMethods);

/**
 * Get terminal sessions count for monitoring.
 */
export function getTerminalSessionsCount(): number {
  return terminalSessions.size;
}

/**
 * Close all terminal sessions for a tenant.
 * Called when tenant is disabled or deleted.
 */
export function closeAllTenantTerminals(tenantId: string): number {
  let closed = 0;
  for (const [terminalId, session] of terminalSessions) {
    if (session.tenantId === tenantId) {
      try {
        session.pty.kill();
      } catch {
        // ignore
      }
      terminalSessions.delete(terminalId);
      closed++;
    }
  }
  return closed;
}
