/**
 * Bubblewrap sandbox execution.
 * OPENCLAWMU ADDITION: bwrap backend for openclawmu multi-tenancy.
 *
 * Provides lightweight Linux user-namespace isolation using bubblewrap (bwrap).
 * This is an alternative to Docker that doesn't require root or a container runtime.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type SandboxBwrapConfig,
  type BwrapExecOptions,
  type BwrapExecResult,
  type SandboxResourceLimits,
  type SandboxInfo,
  resolveBwrapConfig,
  DEFAULT_RESOURCE_LIMITS,
} from "./types.bwrap.js";

/**
 * System paths to bind-mount read-only into the sandbox.
 * These provide a minimal Linux userland.
 */
const SYSTEM_RO_BINDS = [
  { src: "/usr", dest: "/usr" },
  { src: "/bin", dest: "/bin" },
  { src: "/sbin", dest: "/sbin" },
  { src: "/lib", dest: "/lib" },
  { src: "/lib64", dest: "/lib64", optional: true },
  { src: "/etc/resolv.conf", dest: "/etc/resolv.conf", optional: true },
  { src: "/etc/hosts", dest: "/etc/hosts", optional: true },
  { src: "/etc/passwd", dest: "/etc/passwd", optional: true },
  { src: "/etc/group", dest: "/etc/group", optional: true },
  { src: "/etc/ssl", dest: "/etc/ssl", optional: true },
  { src: "/etc/ca-certificates", dest: "/etc/ca-certificates", optional: true },
];

/**
 * Checks if bwrap is available on the system.
 */
export async function isBwrapAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("bwrap", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Gets the bwrap version string.
 */
export async function getBwrapVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("bwrap", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        const version = stdout.trim().replace(/^bubblewrap\s+/i, "");
        resolve(version || null);
      } else {
        resolve(null);
      }
    });
    child.on("error", () => {
      resolve(null);
    });
  });
}

/**
 * Builds command-line arguments for bwrap.
 */
export function buildBwrapArgs(params: {
  config: SandboxBwrapConfig;
  workspaceDir: string;
  tenantStateDir?: string;
  readOnlyWorkspace?: boolean;
}): string[] {
  const { config, workspaceDir, tenantStateDir, readOnlyWorkspace } = params;
  const args: string[] = [];

  // Namespace unsharing
  if (config.unshareUser) {
    args.push("--unshare-user");
    args.push("--uid", String(config.uid));
    args.push("--gid", String(config.gid));
  }
  if (config.unsharePid) {
    args.push("--unshare-pid");
  }
  if (config.unshareIpc) {
    args.push("--unshare-ipc");
  }
  if (config.unshareNet && config.networkIsolation) {
    args.push("--unshare-net");
  }
  if (config.unshareCgroup) {
    args.push("--unshare-cgroup");
  }

  // System binds (read-only)
  for (const bind of SYSTEM_RO_BINDS) {
    if (bind.optional && !fs.existsSync(bind.src)) {
      continue;
    }
    if (fs.existsSync(bind.src)) {
      args.push("--ro-bind", bind.src, bind.dest);
    }
  }

  // Proc and dev
  args.push("--proc", "/proc");
  args.push("--dev", "/dev");

  // Tmpfs mounts
  for (const tmpfs of config.tmpfs) {
    args.push("--tmpfs", tmpfs);
  }

  // Create /etc if needed (for our binds)
  args.push("--dir", "/etc");

  // Workspace mount
  if (readOnlyWorkspace) {
    args.push("--ro-bind", workspaceDir, config.workdir);
  } else {
    args.push("--bind", workspaceDir, config.workdir);
  }

  // Tenant state directory (for memory, sessions, etc.)
  if (tenantStateDir && fs.existsSync(tenantStateDir)) {
    args.push("--bind", tenantStateDir, "/openclaw-state");
  }

  // Additional binds from config
  for (const bind of config.roBinds) {
    const [src, dest] = bind.split(":");
    if (src && dest && fs.existsSync(src)) {
      args.push("--ro-bind", src, dest);
    }
  }
  for (const bind of config.rwBinds) {
    const [src, dest] = bind.split(":");
    if (src && dest && fs.existsSync(src)) {
      args.push("--bind", src, dest);
    }
  }

  // Working directory
  args.push("--chdir", config.workdir);

  // Lifecycle options
  if (config.dieWithParent) {
    args.push("--die-with-parent");
  }
  if (config.newSession) {
    args.push("--new-session");
  }

  return args;
}

/**
 * Executes a command inside a bwrap sandbox.
 */
export async function execBwrap(options: BwrapExecOptions): Promise<BwrapExecResult> {
  const config = resolveBwrapConfig(options.config);

  // Ensure workspace directory exists
  if (!fs.existsSync(options.workspaceDir)) {
    fs.mkdirSync(options.workspaceDir, { recursive: true });
  }

  const bwrapArgs = buildBwrapArgs({
    config,
    workspaceDir: options.workspaceDir,
    tenantStateDir: options.tenantStateDir,
  });

  // Add command separator and command
  bwrapArgs.push("--");
  bwrapArgs.push(...options.command);

  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      HOME: config.workdir,
      USER: "user",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TERM: "xterm-256color",
      ...config.env,
      ...options.env,
    };

    const child = spawn(config.binary, bwrapArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = options.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeout)
      : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      const exitCode = code ?? 0;
      if (timedOut) {
        if (options.allowFailure) {
          resolve({ stdout, stderr: stderr + "\n[bwrap timeout]", code: 124 });
        } else {
          reject(new Error("bwrap execution timed out"));
        }
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        reject(new Error(stderr.trim() || `bwrap failed with code ${exitCode}`));
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });

    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (options.allowFailure) {
        resolve({ stdout, stderr: err.message, code: 1 });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Spawns an interactive process inside a bwrap sandbox.
 * Returns the child process for interactive use.
 */
export function spawnBwrap(params: {
  config?: Partial<SandboxBwrapConfig>;
  workspaceDir: string;
  tenantStateDir?: string;
  command: string[];
  env?: Record<string, string>;
  readOnlyWorkspace?: boolean;
}): ChildProcessWithoutNullStreams {
  const config = resolveBwrapConfig(params.config);

  // Ensure workspace directory exists
  if (!fs.existsSync(params.workspaceDir)) {
    fs.mkdirSync(params.workspaceDir, { recursive: true });
  }

  const bwrapArgs = buildBwrapArgs({
    config,
    workspaceDir: params.workspaceDir,
    tenantStateDir: params.tenantStateDir,
    readOnlyWorkspace: params.readOnlyWorkspace,
  });

  // Add command separator and command
  bwrapArgs.push("--");
  bwrapArgs.push(...params.command);

  const env: Record<string, string> = {
    HOME: config.workdir,
    USER: "user",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    TERM: "xterm-256color",
    ...config.env,
    ...params.env,
  };

  return spawn(config.binary, bwrapArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
}

/**
 * Creates a bwrap sandbox context similar to Docker's.
 * This is used for compatibility with the existing sandbox infrastructure.
 */
export function createBwrapSandboxContext(params: {
  sessionKey: string;
  workspaceDir: string;
  tenantStateDir?: string;
  config?: Partial<SandboxBwrapConfig>;
}) {
  const config = resolveBwrapConfig(params.config);
  return {
    type: "bwrap" as const,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
    tenantStateDir: params.tenantStateDir,
    containerWorkdir: config.workdir,
    config,
  };
}

/**
 * Resolves the sandbox workspace path for a given tenant and scope.
 */
export function resolveBwrapWorkspacePath(params: {
  tenantId?: string;
  agentId: string;
  sessionKey?: string;
  baseDir?: string;
}): string {
  const base =
    params.baseDir ??
    process.env.OPENCLAW_STATE_DIR ??
    path.join(process.env.HOME ?? "/tmp", ".openclaw");
  if (params.tenantId) {
    return path.join(base, "tenants", params.tenantId, "workspace");
  }
  return path.join(base, "sandboxes", params.agentId);
}

// ============================================================================
// Resource Limits via systemd-run
// ============================================================================

/**
 * Checks if systemd-run is available for applying resource limits.
 */
export async function isSystemdRunAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("systemd-run", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Builds systemd-run arguments for applying resource limits.
 */
export function buildSystemdRunArgs(params: {
  scopeName: string;
  limits: SandboxResourceLimits;
  userMode?: boolean;
}): string[] {
  const { scopeName, limits, userMode = true } = params;
  const args: string[] = [];

  // Use user mode by default (doesn't require root)
  if (userMode) {
    args.push("--user");
  }

  // Run as a scope (not a service)
  args.push("--scope");

  // Set the scope name for identification
  args.push(`--unit=openclaw-sandbox-${scopeName}`);

  // Apply resource limits via properties
  if (limits.cpuQuotaPercent !== undefined) {
    args.push(`--property=CPUQuota=${limits.cpuQuotaPercent}%`);
  }

  if (limits.memoryLimitMB !== undefined) {
    args.push(`--property=MemoryMax=${limits.memoryLimitMB}M`);
    // Also set high to enable memory accounting
    args.push(`--property=MemoryHigh=${Math.floor(limits.memoryLimitMB * 0.9)}M`);
  }

  if (limits.pidsLimit !== undefined) {
    args.push(`--property=TasksMax=${limits.pidsLimit}`);
  }

  if (limits.ioWeight !== undefined) {
    args.push(`--property=IOWeight=${limits.ioWeight}`);
  }

  // Collect resource usage
  args.push("--property=CPUAccounting=true");
  args.push("--property=MemoryAccounting=true");
  args.push("--property=TasksAccounting=true");

  return args;
}

/**
 * Executes a command inside a bwrap sandbox with resource limits.
 * Uses systemd-run to wrap bwrap with cgroup limits.
 */
export async function execBwrapWithLimits(
  options: BwrapExecOptions & {
    resourceLimits?: SandboxResourceLimits;
    scopeName?: string;
  },
): Promise<BwrapExecResult> {
  const config = resolveBwrapConfig(options.config);
  const limits = options.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;
  const scopeName = options.scopeName ?? `exec-${Date.now()}`;

  // Ensure workspace directory exists
  if (!fs.existsSync(options.workspaceDir)) {
    fs.mkdirSync(options.workspaceDir, { recursive: true });
  }

  // Check if systemd-run is available
  const hasSystemdRun = await isSystemdRunAvailable();

  // Build bwrap arguments
  const bwrapArgs = buildBwrapArgs({
    config,
    workspaceDir: options.workspaceDir,
    tenantStateDir: options.tenantStateDir,
  });
  bwrapArgs.push("--");
  bwrapArgs.push(...options.command);

  // Build final command
  let finalCommand: string;
  let finalArgs: string[];

  if (hasSystemdRun && limits) {
    // Wrap with systemd-run for resource limits
    const systemdArgs = buildSystemdRunArgs({ scopeName, limits });
    finalCommand = "systemd-run";
    finalArgs = [...systemdArgs, "--", config.binary, ...bwrapArgs];
  } else {
    // Fall back to plain bwrap without limits
    finalCommand = config.binary;
    finalArgs = bwrapArgs;
  }

  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      HOME: config.workdir,
      USER: "user",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TERM: "xterm-256color",
      ...config.env,
      ...options.env,
    };

    const child = spawn(finalCommand, finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = options.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeout)
      : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      const exitCode = code ?? 0;
      if (timedOut) {
        if (options.allowFailure) {
          resolve({ stdout, stderr: stderr + "\n[bwrap timeout]", code: 124 });
        } else {
          reject(new Error("bwrap execution timed out"));
        }
        return;
      }
      if (exitCode !== 0 && !options.allowFailure) {
        reject(new Error(stderr.trim() || `bwrap failed with code ${exitCode}`));
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });

    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (options.allowFailure) {
        resolve({ stdout, stderr: err.message, code: 1 });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Spawns an interactive process inside a bwrap sandbox with resource limits.
 */
export async function spawnBwrapWithLimits(params: {
  config?: Partial<SandboxBwrapConfig>;
  workspaceDir: string;
  tenantStateDir?: string;
  command: string[];
  env?: Record<string, string>;
  readOnlyWorkspace?: boolean;
  resourceLimits?: SandboxResourceLimits;
  scopeName?: string;
}): Promise<{
  child: ChildProcessWithoutNullStreams;
  scopeName: string;
}> {
  const config = resolveBwrapConfig(params.config);
  const limits = params.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;
  const scopeName = params.scopeName ?? `spawn-${Date.now()}`;

  // Ensure workspace directory exists
  if (!fs.existsSync(params.workspaceDir)) {
    fs.mkdirSync(params.workspaceDir, { recursive: true });
  }

  const bwrapArgs = buildBwrapArgs({
    config,
    workspaceDir: params.workspaceDir,
    tenantStateDir: params.tenantStateDir,
    readOnlyWorkspace: params.readOnlyWorkspace,
  });
  bwrapArgs.push("--");
  bwrapArgs.push(...params.command);

  const env: Record<string, string> = {
    HOME: config.workdir,
    USER: "user",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    TERM: "xterm-256color",
    ...config.env,
    ...params.env,
  };

  // Check if systemd-run is available
  const hasSystemdRun = await isSystemdRunAvailable();

  let child: ChildProcessWithoutNullStreams;

  if (hasSystemdRun && limits) {
    const systemdArgs = buildSystemdRunArgs({ scopeName, limits });
    child = spawn("systemd-run", [...systemdArgs, "--", config.binary, ...bwrapArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  } else {
    child = spawn(config.binary, bwrapArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  }

  return { child, scopeName };
}

/**
 * Gets resource usage for a systemd scope.
 */
export async function getSandboxResourceUsage(scopeName: string): Promise<{
  cpuUsageUs?: number;
  memoryBytes?: number;
  pidsCount?: number;
} | null> {
  const unitName = `openclaw-sandbox-${scopeName}.scope`;

  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      const child = spawn(
        "systemctl",
        ["--user", "show", unitName, "--property=CPUUsageNSec,MemoryCurrent,TasksCurrent"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout });
        } else {
          reject(new Error(`Failed to get scope stats: ${code}`));
        }
      });
      child.on("error", reject);
    });

    const lines = stdout.trim().split("\n");
    const props: Record<string, string> = {};
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key && value) {
        props[key] = value;
      }
    }

    return {
      cpuUsageUs: props.CPUUsageNSec
        ? Math.floor(parseInt(props.CPUUsageNSec, 10) / 1000)
        : undefined,
      memoryBytes:
        props.MemoryCurrent && props.MemoryCurrent !== "[not set]"
          ? parseInt(props.MemoryCurrent, 10)
          : undefined,
      pidsCount:
        props.TasksCurrent && props.TasksCurrent !== "[not set]"
          ? parseInt(props.TasksCurrent, 10)
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Stops a sandbox by its scope name.
 */
export async function stopSandboxScope(scopeName: string): Promise<boolean> {
  const unitName = `openclaw-sandbox-${scopeName}.scope`;

  return new Promise((resolve) => {
    const child = spawn("systemctl", ["--user", "stop", unitName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

// Export types
export type { SandboxResourceLimits, SandboxInfo };
