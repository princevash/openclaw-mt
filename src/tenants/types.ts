/**
 * Tenant types for multi-tenancy support.
 * OPENCLAWMU ADDITION: tenant domain model.
 *
 * Tenants are isolated units within the gateway, each with:
 * - Unique authentication token
 * - Isolated data paths (sessions, memory, plugins, sandboxes)
 * - Separate sandbox environments
 */

/**
 * Tenant ID format: lowercase alphanumeric with hyphens/underscores.
 * Pattern: ^[a-z0-9][a-z0-9_-]{0,31}$
 * Examples: "demo", "user-123", "prod_tenant"
 */
export type TenantId = string;

/**
 * Regex pattern for validating tenant IDs.
 */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Validates a tenant ID format.
 */
export function isValidTenantId(id: string): id is TenantId {
  return TENANT_ID_PATTERN.test(id);
}

/**
 * Tenant context with resolved paths and authentication info.
 */
export type TenantContext = {
  /** Unique tenant identifier. */
  tenantId: TenantId;
  /** SHA-256 hash of the tenant's authentication token. */
  tokenHash: string;
  /** Tenant-specific state directory: {baseStateDir}/tenants/{tenantId} */
  stateDir: string;
  /** ISO timestamp of tenant creation. */
  createdAt: string;
  /** ISO timestamp of last activity. */
  lastSeenAt?: string;
};

/**
 * Resource quotas for a tenant.
 * All limits are optional - if not set, no limit is enforced.
 */
export type TenantQuotas = {
  /** Monthly token limit (hard limit - blocks requests when exceeded). */
  monthlyTokenLimit?: number;
  /** Monthly token soft limit (warning threshold, e.g., 80% of hard limit). */
  monthlyTokenSoftLimit?: number;

  /** Monthly cost limit in cents (hard limit). */
  monthlyCostLimitCents?: number;
  /** Monthly cost soft limit in cents (warning threshold). */
  monthlyCostSoftLimitCents?: number;

  /** Disk space limit in bytes. */
  diskSpaceLimitBytes?: number;

  /** Maximum concurrent sessions. */
  maxConcurrentSessions?: number;

  /** API rate limit: requests per minute. */
  requestsPerMinute?: number;
  /** API rate limit: requests per hour. */
  requestsPerHour?: number;

  /** Sandbox CPU quota (100 = 1 full core). */
  maxSandboxCpuPercent?: number;
  /** Sandbox memory limit in MB. */
  maxSandboxMemoryMB?: number;
  /** Sandbox disk limit in MB. */
  maxSandboxDiskMB?: number;
  /** Maximum processes (PIDs) in sandbox. */
  maxSandboxPids?: number;
};

/**
 * Stored tenant entry in the registry.
 */
export type TenantEntry = {
  /** SHA-256 hash of the tenant's authentication token. */
  tokenHash: string;
  /** ISO timestamp of tenant creation. */
  createdAt: string;
  /** ISO timestamp of last activity (updated on each auth). */
  lastSeenAt?: string;
  /** Display name for the tenant (optional). */
  displayName?: string;
  /** Whether the tenant is disabled (prevents auth). */
  disabled?: boolean;
  /** Resource quotas for this tenant. */
  quotas?: TenantQuotas;
};

/**
 * Tenant registry stored at {stateDir}/tenants.json.
 */
export type TenantRegistry = {
  /** Registry format version. */
  version: 1;
  /** Map of tenant IDs to tenant entries. */
  tenants: Record<TenantId, TenantEntry>;
};

/**
 * Result of creating a new tenant.
 */
export type CreateTenantResult = {
  /** The new tenant's ID. */
  tenantId: TenantId;
  /** The plaintext authentication token (only returned at creation). */
  token: string;
  /** ISO timestamp of creation. */
  createdAt: string;
};

/**
 * Options for removing a tenant.
 */
export type RemoveTenantOptions = {
  /** Whether to delete all tenant data (default: false). */
  deleteData?: boolean;
};

/**
 * Tenant authentication token format.
 * Format: "tenant:{tenantId}:{token}"
 */
export type TenantTokenFormat = `tenant:${string}:${string}`;

/**
 * Parses a tenant token into its components.
 * Returns null if the token format is invalid.
 */
export function parseTenantToken(token: string): { tenantId: string; secret: string } | null {
  if (!token.startsWith("tenant:")) {
    return null;
  }
  const parts = token.split(":");
  if (parts.length < 3) {
    return null;
  }
  const [, tenantId, ...rest] = parts;
  const secret = rest.join(":");
  if (!tenantId || !secret) {
    return null;
  }
  return { tenantId, secret };
}

/**
 * Builds a tenant token string from components.
 */
export function buildTenantToken(tenantId: string, secret: string): TenantTokenFormat {
  return `tenant:${tenantId}:${secret}`;
}

// ============================================================================
// Tenant Usage Tracking Types
// ============================================================================

/**
 * Snapshot of a tenant's resource usage for a given period.
 */
export type TenantUsageSnapshot = {
  /** Tenant ID. */
  tenantId: TenantId;
  /** Period in YYYY-MM format (monthly). */
  period: string;

  // Token usage
  /** Total tokens used (input + output). */
  totalTokens: number;
  /** Input tokens used. */
  inputTokens: number;
  /** Output tokens used. */
  outputTokens: number;
  /** Cache read tokens. */
  cacheReadTokens: number;
  /** Cache write tokens. */
  cacheWriteTokens: number;

  // Cost (in cents)
  /** Total cost in cents. */
  totalCostCents: number;

  // Disk usage
  /** Total disk usage in bytes. */
  diskUsageBytes: number;
  /** Workspace directory size in bytes. */
  workspaceBytes: number;
  /** Agent data size in bytes. */
  agentDataBytes: number;
  /** Memory database size in bytes. */
  memoryDbBytes: number;

  // Session metrics
  /** Total sessions this period. */
  totalSessions: number;
  /** Currently active sessions. */
  activeSessions: number;
  /** Total messages sent. */
  totalMessages: number;

  // API metrics
  /** Total API requests this period. */
  totalRequests: number;
  /** Requests in the current minute window. */
  requestsThisMinute: number;
  /** Requests in the current hour window. */
  requestsThisHour: number;

  // Sandbox metrics
  /** Total CPU seconds used in sandboxes. */
  sandboxCpuSeconds: number;
  /** Peak memory usage in MB. */
  sandboxPeakMemoryMB: number;

  // Timestamps
  /** Last update timestamp (Unix ms). */
  updatedAt: number;
  /** When quota resets (first of next month, Unix ms). */
  quotaResetAt: number;
};

/**
 * Tenant quota status with current usage and limit checks.
 */
export type TenantQuotaStatus = {
  /** Tenant ID. */
  tenantId: TenantId;
  /** Configured quotas. */
  quotas: TenantQuotas;
  /** Current usage snapshot. */
  usage: TenantUsageSnapshot;

  // Usage percentages
  /** Token usage as percentage of limit (0-100+). */
  tokenUsagePercent: number;
  /** Cost usage as percentage of limit (0-100+). */
  costUsagePercent: number;
  /** Disk usage as percentage of limit (0-100+). */
  diskUsagePercent: number;

  // Limit flags
  /** Whether token hard limit is exceeded. */
  isOverTokenLimit: boolean;
  /** Whether cost hard limit is exceeded. */
  isOverCostLimit: boolean;
  /** Whether disk space limit is exceeded. */
  isOverDiskLimit: boolean;
  /** Whether any soft limit is exceeded. */
  isAtSoftLimit: boolean;
  /** Whether tenant should be blocked (any hard limit exceeded). */
  isBlocked: boolean;
};

/**
 * Rate limit state for rolling window tracking.
 */
export type RateLimitState = {
  /** Request timestamps in the current minute window. */
  minuteWindow: number[];
  /** Request timestamps in the current hour window. */
  hourWindow: number[];
  /** Last cleanup timestamp. */
  lastCleanup: number;
};

/**
 * Result of a quota check before processing a request.
 */
export type QuotaCheckResult = {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Reason for denial (if not allowed). */
  reason?: "quota_exceeded" | "rate_limited" | "disk_full" | "sessions_exceeded";
  /** Human-readable message. */
  message?: string;
  /** Warning message (if allowed but approaching limit). */
  warning?: string;
};
