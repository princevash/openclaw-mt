/**
 * Bubblewrap PTY support for interactive terminal sessions.
 * OPENCLAWMU ADDITION: tenant-scoped web terminal backend.
 *
 * Spawns a pseudo-terminal inside a bwrap sandbox for web terminal access.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import type { SandboxBwrapConfig } from "./types.bwrap.js";
import { resolveTenantStateDir, resolveTenantWorkspace } from "../../tenants/paths.js";
import { buildBwrapArgs } from "./bwrap.js";
import { DEFAULT_BWRAP_CONFIG } from "./types.bwrap.js";

export type BwrapPtyOptions = {
  /** Tenant ID for isolation. */
  tenantId: string;
  /** Shell to spawn (default: /bin/bash). */
  shell?: string;
  /** Terminal columns (default: 80). */
  cols?: number;
  /** Terminal rows (default: 24). */
  rows?: number;
  /** Additional environment variables. */
  env?: Record<string, string>;
  /** Custom workspace directory (overrides tenant default). */
  workspaceDir?: string;
  /** Bwrap configuration overrides. */
  bwrapConfig?: Partial<SandboxBwrapConfig>;
};

export type BwrapPtyHandle = {
  /** Process ID. */
  pid: number;
  /** Write data to the PTY. */
  write: (data: string | Buffer) => void;
  /** Resize the terminal. */
  resize: (cols: number, rows: number) => void;
  /** Kill the process. */
  kill: (signal?: NodeJS.Signals) => void;
  /** Event handler for data. */
  onData: (callback: (data: string) => void) => void;
  /** Event handler for exit. */
  onExit: (callback: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  /** The underlying child process. */
  process: ChildProcessWithoutNullStreams;
};

/**
 * Spawns a PTY inside a bwrap sandbox.
 *
 * This creates an interactive shell session inside a sandboxed environment.
 * The shell runs with tenant-specific isolation.
 */
export async function spawnBwrapPty(options: BwrapPtyOptions): Promise<BwrapPtyHandle> {
  const {
    tenantId,
    shell = "/bin/bash",
    cols = 80,
    rows = 24,
    env = {},
    workspaceDir,
    bwrapConfig = {},
  } = options;

  // Resolve tenant paths
  const tenantWorkspace = workspaceDir ?? resolveTenantWorkspace(tenantId);
  const tenantStateDir = resolveTenantStateDir(tenantId);

  // Merge bwrap config
  const config: SandboxBwrapConfig = {
    ...DEFAULT_BWRAP_CONFIG,
    ...bwrapConfig,
    env: {
      ...DEFAULT_BWRAP_CONFIG.env,
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
      ...env,
    },
  };

  // Build bwrap arguments
  const bwrapArgs = buildBwrapArgs({
    config,
    workspaceDir: tenantWorkspace,
    tenantStateDir,
    readOnlyWorkspace: false, // Interactive sessions need write access
  });

  // We spawn bwrap with script to get a PTY
  // Using 'script' command to create a PTY within bwrap
  const scriptArgs = [
    "-q", // Quiet mode
    "-c",
    shell, // Command to run
    "/dev/null", // Output file (we capture via stdout)
  ];

  // Spawn the process
  const child = spawn("bwrap", [...bwrapArgs, "--", "script", ...scriptArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  // Data event handlers
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

  // Handle stdout
  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const callback of dataCallbacks) {
      callback(text);
    }
  });

  // Handle stderr (merge with stdout for terminal)
  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const callback of dataCallbacks) {
      callback(text);
    }
  });

  // Handle exit
  child.on("close", (code, signal) => {
    for (const callback of exitCallbacks) {
      callback(code, signal);
    }
  });

  // Handle errors
  child.on("error", (err) => {
    for (const callback of exitCallbacks) {
      callback(null, null);
    }
    console.error("bwrap-pty error:", err);
  });

  return {
    pid: child.pid ?? 0,

    write: (data: string | Buffer) => {
      if (child.stdin.writable) {
        child.stdin.write(data);
      }
    },

    resize: (newCols: number, newRows: number) => {
      // Send terminal resize escape sequence
      // Note: This is a simplified approach; proper PTY resize requires ioctl
      // For full PTY support, consider using node-pty directly
      if (child.stdin.writable) {
        // Set COLUMNS and LINES environment in the shell
        child.stdin.write(`stty cols ${newCols} rows ${newRows}\n`);
      }
    },

    kill: (signal: NodeJS.Signals = "SIGTERM") => {
      child.kill(signal);
    },

    onData: (callback: (data: string) => void) => {
      dataCallbacks.push(callback);
    },

    onExit: (callback: (code: number | null, signal: NodeJS.Signals | null) => void) => {
      exitCallbacks.push(callback);
    },

    process: child,
  };
}

/**
 * Spawns a bwrap PTY using node-pty for better terminal emulation.
 *
 * This provides full PTY support with proper resize handling.
 * Falls back to the simple spawn method if node-pty is not available.
 */
export async function spawnBwrapPtyWithNodePty(
  options: BwrapPtyOptions,
): Promise<BwrapPtyHandle | null> {
  try {
    // Try to import node-pty
    const ptyModule = (await import("@lydell/node-pty")) as unknown as {
      spawn?: (
        file: string,
        args: string[],
        options: {
          name?: string;
          cols?: number;
          rows?: number;
          cwd?: string;
          env?: Record<string, string>;
        },
      ) => {
        pid: number;
        write: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        kill: (signal?: string) => void;
        onData: (callback: (data: string) => void) => void;
        onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => void;
      };
      default?: {
        spawn?: typeof ptyModule.spawn;
      };
    };

    const spawnPty = ptyModule.spawn ?? ptyModule.default?.spawn;
    if (!spawnPty) {
      return null;
    }

    const {
      tenantId,
      shell = "/bin/bash",
      cols = 80,
      rows = 24,
      env = {},
      workspaceDir,
      bwrapConfig = {},
    } = options;

    // Resolve tenant paths
    const tenantWorkspace = workspaceDir ?? resolveTenantWorkspace(tenantId);
    const tenantStateDir = resolveTenantStateDir(tenantId);

    // Merge bwrap config
    const config: SandboxBwrapConfig = {
      ...DEFAULT_BWRAP_CONFIG,
      ...bwrapConfig,
      env: {
        ...DEFAULT_BWRAP_CONFIG.env,
        TERM: "xterm-256color",
        ...env,
      },
    };

    // Build bwrap arguments
    const bwrapArgs = buildBwrapArgs({
      config,
      workspaceDir: tenantWorkspace,
      tenantStateDir,
      readOnlyWorkspace: false,
    });

    // Spawn PTY with bwrap
    const pty = spawnPty("bwrap", [...bwrapArgs, "--", shell], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: tenantWorkspace,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        HOME: "/workspace",
        ...env,
      } as Record<string, string>,
    });

    // Exit callbacks for conversion
    const exitCallbacks: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

    pty.onExit((event) => {
      const signal = event.signal ? (`SIG${event.signal}` as NodeJS.Signals) : null;
      for (const callback of exitCallbacks) {
        callback(event.exitCode, signal);
      }
    });

    return {
      pid: pty.pid,
      write: (data) => pty.write(typeof data === "string" ? data : data.toString()),
      resize: (c, r) => pty.resize(c, r),
      kill: (signal) => pty.kill(signal),
      onData: (callback) => pty.onData(callback),
      onExit: (callback) => exitCallbacks.push(callback),
      process: null as unknown as ChildProcessWithoutNullStreams, // node-pty doesn't expose this
    };
  } catch {
    // node-pty not available
    return null;
  }
}

/**
 * Spawns a bwrap PTY, preferring node-pty if available.
 */
export async function spawnBwrapPtyAuto(options: BwrapPtyOptions): Promise<BwrapPtyHandle> {
  // Try node-pty first for better terminal support
  const nodePtyHandle = await spawnBwrapPtyWithNodePty(options);
  if (nodePtyHandle) {
    return nodePtyHandle;
  }

  // Fall back to simple spawn
  return spawnBwrapPty(options);
}
