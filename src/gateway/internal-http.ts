/**
 * Internal HTTP API for control plane integration.
 *
 * Provides HTTP endpoints that wrap WebSocket RPC methods for:
 * - Tenant backup/restore operations
 * - Tenant management (create, delete, status)
 *
 * Authentication via X-Control-Plane-Token header.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import os from "node:os";
import { loadConfig } from "../config/config.js";
import {
  backupTenantToS3,
  restoreTenantFromS3,
  listTenantBackups,
  deleteTenantBackup,
  listTenants,
  getTenant,
  createTenant,
  removeTenant,
  type BackupConfig,
} from "../tenants/index.js";
import { sendJson, sendText, readJsonBodyOrError } from "./http-common.js";
import { getHeader } from "./http-utils.js";

const INTERNAL_API_PREFIX = "/internal/v1";

/**
 * Validates the control plane token from request headers.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function validateControlPlaneToken(req: IncomingMessage): boolean {
  const config = loadConfig();
  const expectedToken = config.gateway?.controlPlaneToken;

  if (!expectedToken) {
    // No token configured, reject all requests
    return false;
  }

  const providedToken = getHeader(req, "x-control-plane-token") ?? "";

  // Use timing-safe comparison to prevent timing attacks
  if (providedToken.length !== expectedToken.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken));
}

/**
 * Parse URL path to extract tenant ID and action.
 * Expected patterns:
 *   /internal/v1/tenants/:tenantId
 *   /internal/v1/tenants/:tenantId/backup
 *   /internal/v1/tenants/:tenantId/restore
 *   /internal/v1/tenants/:tenantId/backups
 *   /internal/v1/tenants/:tenantId/backups/:key
 *   /internal/v1/status
 */
function parseInternalPath(pathname: string): {
  resource: "tenants" | "status" | null;
  tenantId?: string;
  action?: "backup" | "restore" | "backups";
  backupKey?: string;
} {
  if (!pathname.startsWith(INTERNAL_API_PREFIX)) {
    return { resource: null };
  }

  const subPath = pathname.slice(INTERNAL_API_PREFIX.length);

  if (subPath === "/status") {
    return { resource: "status" };
  }

  const tenantsMatch = subPath.match(/^\/tenants\/([^/]+)(?:\/(.+))?$/);
  if (tenantsMatch) {
    const tenantId = tenantsMatch[1];
    const rest = tenantsMatch[2];

    if (!rest) {
      return { resource: "tenants", tenantId };
    }

    if (rest === "backup") {
      return { resource: "tenants", tenantId, action: "backup" };
    }

    if (rest === "restore") {
      return { resource: "tenants", tenantId, action: "restore" };
    }

    if (rest === "backups") {
      return { resource: "tenants", tenantId, action: "backups" };
    }

    // Check for /backups/:key pattern
    const backupsKeyMatch = rest.match(/^backups\/(.+)$/);
    if (backupsKeyMatch) {
      return {
        resource: "tenants",
        tenantId,
        action: "backups",
        backupKey: decodeURIComponent(backupsKeyMatch[1]),
      };
    }
  }

  return { resource: null };
}

/**
 * Extract S3 config from request body or query params.
 */
function extractBackupConfig(
  body: Record<string, unknown>,
  query: URLSearchParams,
): BackupConfig | null {
  const bucket = (body.bucket as string) || query.get("bucket");
  if (!bucket) {
    return null;
  }

  return {
    bucket,
    endpoint: (body.endpoint as string) || query.get("endpoint") || undefined,
    region: (body.region as string) || query.get("region") || undefined,
    prefix: (body.prefix as string) || query.get("prefix") || undefined,
  };
}

/**
 * Handle backup request.
 */
async function handleBackup(
  res: ServerResponse,
  tenantId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const config = extractBackupConfig(body, new URLSearchParams());
  if (!config) {
    sendJson(res, 400, { error: "bucket is required" });
    return;
  }

  try {
    const result = await backupTenantToS3({ tenantId, config });
    sendJson(res, 200, {
      key: result.key,
      tenantId: result.tenantId,
      timestamp: result.timestamp,
      size: result.size,
    });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle restore request.
 */
async function handleRestore(
  res: ServerResponse,
  tenantId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const config = extractBackupConfig(body, new URLSearchParams());
  if (!config) {
    sendJson(res, 400, { error: "bucket is required" });
    return;
  }

  const key = body.key as string;
  if (!key) {
    sendJson(res, 400, { error: "key is required" });
    return;
  }

  const createIfMissing = body.createIfMissing !== false;

  try {
    const result = await restoreTenantFromS3({
      tenantId,
      config,
      key,
      createIfMissing,
    });
    sendJson(res, 200, {
      tenantId: result.tenantId,
      restoredAt: result.restoredAt,
      sourceKey: result.sourceKey,
    });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle list backups request.
 */
async function handleListBackups(
  res: ServerResponse,
  tenantId: string,
  query: URLSearchParams,
): Promise<void> {
  const config = extractBackupConfig({}, query);
  if (!config) {
    sendJson(res, 400, { error: "bucket is required" });
    return;
  }

  try {
    const backups = await listTenantBackups({ tenantId, config });
    sendJson(res, 200, { backups });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle delete backup request.
 */
async function handleDeleteBackup(
  res: ServerResponse,
  key: string,
  body: Record<string, unknown>,
): Promise<void> {
  const config = extractBackupConfig(body, new URLSearchParams());
  if (!config) {
    sendJson(res, 400, { error: "bucket is required" });
    return;
  }

  try {
    await deleteTenantBackup({ key, config });
    sendJson(res, 200, { deleted: true, key });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle tenant CRUD operations.
 */
async function handleTenantCrud(
  req: IncomingMessage,
  res: ServerResponse,
  tenantId: string,
): Promise<void> {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    const tenant = getTenant(tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: "Tenant not found" });
      return;
    }
    sendJson(res, 200, {
      tenantId,
      displayName: tenant.displayName,
      createdAt: tenant.createdAt,
      lastSeenAt: tenant.lastSeenAt,
      disabled: tenant.disabled,
    });
    return;
  }

  if (method === "POST") {
    // Create tenant
    const body = (await readJsonBodyOrError(req, res, 65536)) as
      | Record<string, unknown>
      | undefined;
    if (body === undefined) {
      return;
    }

    try {
      const result = createTenant(tenantId, {
        displayName: body.displayName as string | undefined,
      });
      sendJson(res, 201, {
        tenantId: result.tenantId,
        token: result.token,
        createdAt: result.createdAt,
      });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (method === "DELETE") {
    try {
      removeTenant(tenantId, { deleteData: true });
      sendJson(res, 200, { deleted: true, tenantId });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  sendText(res, 405, "Method Not Allowed");
}

/**
 * Handle status request.
 */
function handleStatus(res: ServerResponse): void {
  const config = loadConfig();
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const memoryUsedBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const cpuCount = Math.max(1, os.cpus().length);
  const load1m = os.loadavg()[0] ?? 0;
  const tenantsCount = listTenants().length;
  sendJson(res, 200, {
    version: process.env.npm_package_version || "unknown",
    status: "ok",
    capabilities: ["backup", "restore"],
    multiTenant: config.gateway?.multiTenant ?? false,
    tenantsCount,
    metrics: {
      cpuCount,
      load1m,
      memoryTotalBytes: totalMemoryBytes,
      memoryFreeBytes: freeMemoryBytes,
      memoryUsedBytes,
      uptimeSeconds: Math.floor(os.uptime()),
      tenantsCount,
      reportedAt: new Date().toISOString(),
    },
  });
}

/**
 * Main handler for internal HTTP API requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleInternalHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Check if this is an internal API request
  if (!url.pathname.startsWith(INTERNAL_API_PREFIX)) {
    return false;
  }

  // Validate authentication
  if (!validateControlPlaneToken(req)) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Missing or invalid authorization header",
    });
    return true;
  }

  const parsed = parseInternalPath(url.pathname);
  const method = req.method?.toUpperCase();

  // Handle /internal/v1/status
  if (parsed.resource === "status") {
    if (method !== "GET") {
      sendText(res, 405, "Method Not Allowed");
      return true;
    }
    handleStatus(res);
    return true;
  }

  // Handle tenant routes
  if (parsed.resource === "tenants" && parsed.tenantId) {
    const { tenantId, action, backupKey } = parsed;

    // Handle backup action
    if (action === "backup") {
      if (method !== "POST") {
        sendText(res, 405, "Method Not Allowed");
        return true;
      }
      const body = (await readJsonBodyOrError(req, res, 65536)) as
        | Record<string, unknown>
        | undefined;
      if (body === undefined) {
        return true;
      }
      await handleBackup(res, tenantId, body);
      return true;
    }

    // Handle restore action
    if (action === "restore") {
      if (method !== "POST") {
        sendText(res, 405, "Method Not Allowed");
        return true;
      }
      const body = (await readJsonBodyOrError(req, res, 65536)) as
        | Record<string, unknown>
        | undefined;
      if (body === undefined) {
        return true;
      }
      await handleRestore(res, tenantId, body);
      return true;
    }

    // Handle backups list/delete
    if (action === "backups") {
      if (backupKey) {
        // DELETE /internal/v1/tenants/:id/backups/:key
        if (method !== "DELETE") {
          sendText(res, 405, "Method Not Allowed");
          return true;
        }
        const body = (await readJsonBodyOrError(req, res, 65536)) as
          | Record<string, unknown>
          | undefined;
        if (body === undefined) {
          return true;
        }
        await handleDeleteBackup(res, backupKey, body);
        return true;
      } else {
        // GET /internal/v1/tenants/:id/backups
        if (method !== "GET") {
          sendText(res, 405, "Method Not Allowed");
          return true;
        }
        await handleListBackups(res, tenantId, url.searchParams);
        return true;
      }
    }

    // Handle tenant CRUD (no action)
    if (!action) {
      await handleTenantCrud(req, res, tenantId);
      return true;
    }
  }

  // Not found
  sendJson(res, 404, { error: "Not found" });
  return true;
}
