/**
 * Bubblewrap sandbox configuration types.
 * OPENCLAWMU ADDITION: bwrap backend typing for tenant isolation.
 *
 * Bubblewrap (bwrap) provides lightweight Linux user-namespace isolation
 * without requiring root privileges or a container runtime like Docker.
 */

/**
 * Bubblewrap sandbox configuration.
 */
export type SandboxBwrapConfig = {
  /** Path to bwrap binary (default: "bwrap"). */
  binary: string;
  /** Working directory inside sandbox (default: "/workspace"). */
  workdir: string;
  /** Whether to mount root filesystem as read-only (default: true). */
  readOnlyRoot: boolean;
  /** Tmpfs mounts inside the sandbox. */
  tmpfs: string[];
  /** Whether to isolate network (default: true). */
  networkIsolation: boolean;
  /** User ID inside sandbox (default: 1000). */
  uid: number;
  /** Group ID inside sandbox (default: 1000). */
  gid: number;
  /** Additional environment variables. */
  env: Record<string, string>;
  /** Additional read-only bind mounts (host:container format). */
  roBinds: string[];
  /** Additional read-write bind mounts (host:container format). */
  rwBinds: string[];
  /** Process ID limit (0 = unlimited). */
  pidsLimit: number;
  /** Die when parent process exits. */
  dieWithParent: boolean;
  /** Create new session. */
  newSession: boolean;
  /** Unshare user namespace. */
  unshareUser: boolean;
  /** Unshare PID namespace. */
  unsharePid: boolean;
  /** Unshare IPC namespace. */
  unshareIpc: boolean;
  /** Unshare network namespace. */
  unshareNet: boolean;
  /** Unshare cgroup namespace. */
  unshareCgroup: boolean;
};

/**
 * Default bubblewrap configuration.
 */
export const DEFAULT_BWRAP_CONFIG: SandboxBwrapConfig = {
  binary: "bwrap",
  workdir: "/workspace",
  readOnlyRoot: true,
  tmpfs: ["/tmp", "/var/tmp", "/run"],
  networkIsolation: true,
  uid: 1000,
  gid: 1000,
  env: {},
  roBinds: [],
  rwBinds: [],
  pidsLimit: 0,
  dieWithParent: true,
  newSession: true,
  unshareUser: true,
  unsharePid: true,
  unshareIpc: true,
  unshareNet: true,
  unshareCgroup: true,
};

/**
 * Resolves a bwrap config with defaults applied.
 */
export function resolveBwrapConfig(partial?: Partial<SandboxBwrapConfig>): SandboxBwrapConfig {
  return {
    ...DEFAULT_BWRAP_CONFIG,
    ...partial,
    env: { ...DEFAULT_BWRAP_CONFIG.env, ...partial?.env },
    tmpfs: partial?.tmpfs ?? DEFAULT_BWRAP_CONFIG.tmpfs,
    roBinds: partial?.roBinds ?? DEFAULT_BWRAP_CONFIG.roBinds,
    rwBinds: partial?.rwBinds ?? DEFAULT_BWRAP_CONFIG.rwBinds,
  };
}

/**
 * Bwrap execution options.
 */
export type BwrapExecOptions = {
  /** Working directory on host to mount as /workspace. */
  workspaceDir: string;
  /** Optional tenant state directory to mount. */
  tenantStateDir?: string;
  /** Command to execute. */
  command: string[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Bwrap configuration. */
  config?: Partial<SandboxBwrapConfig>;
  /** Allow non-zero exit codes without throwing. */
  allowFailure?: boolean;
  /** Timeout in milliseconds. */
  timeout?: number;
};

/**
 * Bwrap execution result.
 */
export type BwrapExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

/**
 * Resource limits for sandboxes using cgroups v2.
 * These are applied via systemd-run wrapping bwrap.
 */
export type SandboxResourceLimits = {
  /** CPU quota as percentage (100 = 1 full core, 200 = 2 cores). */
  cpuQuotaPercent?: number;
  /** Memory limit in megabytes. */
  memoryLimitMB?: number;
  /** Maximum number of processes (PIDs). */
  pidsLimit?: number;
  /** I/O weight (1-10000, default 100). */
  ioWeight?: number;
  /** Maximum number of open files (soft limit). */
  nofileLimit?: number;
};

/**
 * Default resource limits for sandboxes.
 */
export const DEFAULT_RESOURCE_LIMITS: SandboxResourceLimits = {
  cpuQuotaPercent: 100, // 1 core
  memoryLimitMB: 512, // 512 MB
  pidsLimit: 100, // 100 processes
  ioWeight: 100, // Normal I/O priority
};

/**
 * Information about an active sandbox for monitoring.
 */
export type SandboxInfo = {
  /** Unique sandbox ID. */
  sandboxId: string;
  /** Tenant ID (if multi-tenancy). */
  tenantId?: string;
  /** Agent ID. */
  agentId?: string;
  /** Session key. */
  sessionKey?: string;
  /** Process ID of the bwrap process. */
  pid?: number;
  /** systemd scope name (for cgroup monitoring). */
  scopeName?: string;
  /** When the sandbox was created. */
  createdAt: number;
  /** Resource limits applied. */
  resourceLimits?: SandboxResourceLimits;
  /** Current resource usage (if available). */
  resourceUsage?: {
    cpuUsageUs?: number;
    memoryBytes?: number;
    pidsCount?: number;
  };
};
