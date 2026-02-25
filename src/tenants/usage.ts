/**
 * Tenant usage tracking and quota management.
 * OPENCLAWMU ADDITION: per-tenant quota and usage accounting.
 *
 * Tracks resource consumption per tenant and enforces quotas:
 * - Token usage (input, output, cache)
 * - Cost tracking (in cents)
 * - Disk space usage
 * - Session counts
 * - API rate limiting
 * - Sandbox resource usage
 */

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  TenantId,
  TenantQuotas,
  TenantUsageSnapshot,
  TenantQuotaStatus,
  RateLimitState,
  QuotaCheckResult,
} from "./types.js";
import {
  resolveTenantStateDir,
  resolveTenantUsageCurrentPath,
  resolveTenantUsageDir,
  resolveTenantUsageHistoryPath,
  resolveTenantRateLimitPath,
} from "./paths.js";

const execAsync = promisify(exec);

// ============================================================================
// Usage Snapshot Management
// ============================================================================

/**
 * Gets the current period string (YYYY-MM).
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Calculates the quota reset timestamp (first of next month at midnight UTC).
 */
export function getQuotaResetTimestamp(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0));
  return nextMonth.getTime();
}

/**
 * Creates an empty usage snapshot for a tenant.
 */
export function createEmptyUsageSnapshot(tenantId: TenantId): TenantUsageSnapshot {
  return {
    tenantId,
    period: getCurrentPeriod(),
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostCents: 0,
    diskUsageBytes: 0,
    workspaceBytes: 0,
    agentDataBytes: 0,
    memoryDbBytes: 0,
    totalSessions: 0,
    activeSessions: 0,
    totalMessages: 0,
    totalRequests: 0,
    requestsThisMinute: 0,
    requestsThisHour: 0,
    sandboxCpuSeconds: 0,
    sandboxPeakMemoryMB: 0,
    updatedAt: Date.now(),
    quotaResetAt: getQuotaResetTimestamp(),
  };
}

/**
 * Loads the current usage snapshot for a tenant.
 * Creates a new one if it doesn't exist or if the period has changed.
 */
export async function loadTenantUsage(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantUsageSnapshot> {
  const usagePath = resolveTenantUsageCurrentPath(tenantId, env);
  const currentPeriod = getCurrentPeriod();

  try {
    const content = await fs.readFile(usagePath, "utf-8");
    const snapshot = JSON.parse(content) as TenantUsageSnapshot;

    // Check if we've moved to a new period
    if (snapshot.period !== currentPeriod) {
      // Archive the old snapshot
      await archiveUsageSnapshot(tenantId, snapshot, env);
      // Return a fresh snapshot for the new period
      return createEmptyUsageSnapshot(tenantId);
    }

    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyUsageSnapshot(tenantId);
    }
    throw error;
  }
}

/**
 * Saves the usage snapshot for a tenant.
 */
export async function saveTenantUsage(
  tenantId: TenantId,
  snapshot: TenantUsageSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const usageDir = resolveTenantUsageDir(tenantId, env);
  const usagePath = resolveTenantUsageCurrentPath(tenantId, env);

  // Ensure directory exists
  await fs.mkdir(usageDir, { recursive: true });

  // Update timestamp
  snapshot.updatedAt = Date.now();

  await fs.writeFile(usagePath, JSON.stringify(snapshot, null, 2));
}

/**
 * Archives a usage snapshot to the history directory.
 */
async function archiveUsageSnapshot(
  tenantId: TenantId,
  snapshot: TenantUsageSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const historyPath = resolveTenantUsageHistoryPath(tenantId, snapshot.period, env);
  const usageDir = resolveTenantUsageDir(tenantId, env);

  await fs.mkdir(usageDir, { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(snapshot, null, 2));
}

/**
 * Loads usage history for a tenant.
 */
export async function loadTenantUsageHistory(
  tenantId: TenantId,
  months: number = 6,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantUsageSnapshot[]> {
  const usageDir = resolveTenantUsageDir(tenantId, env);
  const history: TenantUsageSnapshot[] = [];

  try {
    const files = await fs.readdir(usageDir);
    const historyFiles = files
      .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
      .toSorted()
      .toReversed()
      .slice(0, months);

    for (const file of historyFiles) {
      try {
        const content = await fs.readFile(path.join(usageDir, file), "utf-8");
        history.push(JSON.parse(content));
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return history;
}

// ============================================================================
// Usage Updates
// ============================================================================

/**
 * Updates token usage for a tenant.
 */
export async function updateTokenUsage(
  tenantId: TenantId,
  tokens: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
  costCents?: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const snapshot = await loadTenantUsage(tenantId, env);

  snapshot.inputTokens += tokens.input ?? 0;
  snapshot.outputTokens += tokens.output ?? 0;
  snapshot.cacheReadTokens += tokens.cacheRead ?? 0;
  snapshot.cacheWriteTokens += tokens.cacheWrite ?? 0;
  snapshot.totalTokens =
    snapshot.inputTokens +
    snapshot.outputTokens +
    snapshot.cacheReadTokens +
    snapshot.cacheWriteTokens;

  if (costCents !== undefined) {
    snapshot.totalCostCents += costCents;
  }

  snapshot.totalMessages += 1;

  await saveTenantUsage(tenantId, snapshot, env);
}

/**
 * Updates session count for a tenant.
 */
export async function updateSessionCount(
  tenantId: TenantId,
  delta: { total?: number; active?: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const snapshot = await loadTenantUsage(tenantId, env);

  if (delta.total !== undefined) {
    snapshot.totalSessions += delta.total;
  }
  if (delta.active !== undefined) {
    snapshot.activeSessions = Math.max(0, snapshot.activeSessions + delta.active);
  }

  await saveTenantUsage(tenantId, snapshot, env);
}

/**
 * Updates sandbox resource usage for a tenant.
 */
export async function updateSandboxUsage(
  tenantId: TenantId,
  resources: {
    cpuSeconds?: number;
    peakMemoryMB?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const snapshot = await loadTenantUsage(tenantId, env);

  if (resources.cpuSeconds !== undefined) {
    snapshot.sandboxCpuSeconds += resources.cpuSeconds;
  }
  if (resources.peakMemoryMB !== undefined) {
    snapshot.sandboxPeakMemoryMB = Math.max(snapshot.sandboxPeakMemoryMB, resources.peakMemoryMB);
  }

  await saveTenantUsage(tenantId, snapshot, env);
}

// ============================================================================
// Disk Usage Calculation
// ============================================================================

/**
 * Gets the size of a directory in bytes using du command.
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`du -sb "${dirPath}" 2>/dev/null || echo "0"`);
    const size = parseInt(stdout.split("\t")[0], 10);
    return isNaN(size) ? 0 : size;
  } catch {
    return 0;
  }
}

/**
 * Calculates disk usage for a tenant.
 */
export async function calculateTenantDiskUsage(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  totalBytes: number;
  workspaceBytes: number;
  agentDataBytes: number;
  memoryDbBytes: number;
}> {
  const tenantDir = resolveTenantStateDir(tenantId, env);

  const [totalBytes, workspaceBytes, agentDataBytes, memoryDbBytes] = await Promise.all([
    getDirectorySize(tenantDir),
    getDirectorySize(path.join(tenantDir, "workspace")),
    getDirectorySize(path.join(tenantDir, "agents")),
    getDirectorySize(path.join(tenantDir, "memory")),
  ]);

  return { totalBytes, workspaceBytes, agentDataBytes, memoryDbBytes };
}

/**
 * Updates disk usage in the usage snapshot.
 */
export async function updateDiskUsage(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const snapshot = await loadTenantUsage(tenantId, env);
  const diskUsage = await calculateTenantDiskUsage(tenantId, env);

  snapshot.diskUsageBytes = diskUsage.totalBytes;
  snapshot.workspaceBytes = diskUsage.workspaceBytes;
  snapshot.agentDataBytes = diskUsage.agentDataBytes;
  snapshot.memoryDbBytes = diskUsage.memoryDbBytes;

  await saveTenantUsage(tenantId, snapshot, env);
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Loads the rate limit state for a tenant.
 */
async function loadRateLimitState(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RateLimitState> {
  const rateLimitPath = resolveTenantRateLimitPath(tenantId, env);

  try {
    const content = await fs.readFile(rateLimitPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      minuteWindow: [],
      hourWindow: [],
      lastCleanup: Date.now(),
    };
  }
}

/**
 * Saves the rate limit state for a tenant.
 */
async function saveRateLimitState(
  tenantId: TenantId,
  state: RateLimitState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const usageDir = resolveTenantUsageDir(tenantId, env);
  const rateLimitPath = resolveTenantRateLimitPath(tenantId, env);

  await fs.mkdir(usageDir, { recursive: true });
  await fs.writeFile(rateLimitPath, JSON.stringify(state));
}

/**
 * Records a request and checks rate limits.
 * Returns true if the request is allowed.
 */
export async function checkAndRecordRequest(
  tenantId: TenantId,
  quotas: TenantQuotas,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const state = await loadRateLimitState(tenantId, env);

  // Clean up old entries
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;

  state.minuteWindow = state.minuteWindow.filter((t) => t > oneMinuteAgo);
  state.hourWindow = state.hourWindow.filter((t) => t > oneHourAgo);

  // Check rate limits
  if (quotas.requestsPerMinute !== undefined) {
    if (state.minuteWindow.length >= quotas.requestsPerMinute) {
      return { allowed: false, reason: "Rate limit exceeded (per minute)" };
    }
  }

  if (quotas.requestsPerHour !== undefined) {
    if (state.hourWindow.length >= quotas.requestsPerHour) {
      return { allowed: false, reason: "Rate limit exceeded (per hour)" };
    }
  }

  // Record this request
  state.minuteWindow.push(now);
  state.hourWindow.push(now);
  state.lastCleanup = now;

  await saveRateLimitState(tenantId, state, env);

  // Update usage snapshot
  const snapshot = await loadTenantUsage(tenantId, env);
  snapshot.totalRequests += 1;
  snapshot.requestsThisMinute = state.minuteWindow.length;
  snapshot.requestsThisHour = state.hourWindow.length;
  await saveTenantUsage(tenantId, snapshot, env);

  return { allowed: true };
}

// ============================================================================
// Quota Status and Enforcement
// ============================================================================

/**
 * Gets the full quota status for a tenant.
 */
export async function getTenantQuotaStatus(
  tenantId: TenantId,
  quotas: TenantQuotas,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantQuotaStatus> {
  const usage = await loadTenantUsage(tenantId, env);

  // Calculate usage percentages
  const tokenUsagePercent = quotas.monthlyTokenLimit
    ? (usage.totalTokens / quotas.monthlyTokenLimit) * 100
    : 0;

  const costUsagePercent = quotas.monthlyCostLimitCents
    ? (usage.totalCostCents / quotas.monthlyCostLimitCents) * 100
    : 0;

  const diskUsagePercent = quotas.diskSpaceLimitBytes
    ? (usage.diskUsageBytes / quotas.diskSpaceLimitBytes) * 100
    : 0;

  // Check hard limits
  const isOverTokenLimit = quotas.monthlyTokenLimit
    ? usage.totalTokens >= quotas.monthlyTokenLimit
    : false;

  const isOverCostLimit = quotas.monthlyCostLimitCents
    ? usage.totalCostCents >= quotas.monthlyCostLimitCents
    : false;

  const isOverDiskLimit = quotas.diskSpaceLimitBytes
    ? usage.diskUsageBytes >= quotas.diskSpaceLimitBytes
    : false;

  // Check soft limits
  const isAtTokenSoftLimit = quotas.monthlyTokenSoftLimit
    ? usage.totalTokens >= quotas.monthlyTokenSoftLimit
    : false;

  const isAtCostSoftLimit = quotas.monthlyCostSoftLimitCents
    ? usage.totalCostCents >= quotas.monthlyCostSoftLimitCents
    : false;

  const isAtSoftLimit = isAtTokenSoftLimit || isAtCostSoftLimit;

  // Tenant is blocked if any hard limit is exceeded
  const isBlocked = isOverTokenLimit || isOverCostLimit || isOverDiskLimit;

  return {
    tenantId,
    quotas,
    usage,
    tokenUsagePercent,
    costUsagePercent,
    diskUsagePercent,
    isOverTokenLimit,
    isOverCostLimit,
    isOverDiskLimit,
    isAtSoftLimit,
    isBlocked,
  };
}

/**
 * Checks quota before processing a request.
 * Use this before each chat/API request.
 */
export async function checkQuotaBeforeRequest(
  tenantId: TenantId,
  quotas: TenantQuotas,
  env: NodeJS.ProcessEnv = process.env,
): Promise<QuotaCheckResult> {
  // Check rate limits first
  const rateLimitResult = await checkAndRecordRequest(tenantId, quotas, env);
  if (!rateLimitResult.allowed) {
    return {
      allowed: false,
      reason: "rate_limited",
      message: rateLimitResult.reason,
    };
  }

  // Check quota status
  const status = await getTenantQuotaStatus(tenantId, quotas, env);

  if (status.isOverTokenLimit) {
    return {
      allowed: false,
      reason: "quota_exceeded",
      message: "Monthly token quota exceeded",
    };
  }

  if (status.isOverCostLimit) {
    return {
      allowed: false,
      reason: "quota_exceeded",
      message: "Monthly cost limit exceeded",
    };
  }

  if (status.isOverDiskLimit) {
    return {
      allowed: false,
      reason: "disk_full",
      message: "Disk space limit exceeded",
    };
  }

  // Check session limit
  if (quotas.maxConcurrentSessions !== undefined) {
    if (status.usage.activeSessions >= quotas.maxConcurrentSessions) {
      return {
        allowed: false,
        reason: "sessions_exceeded",
        message: "Maximum concurrent sessions reached",
      };
    }
  }

  // Build warning if approaching limits
  let warning: string | undefined;
  if (status.isAtSoftLimit) {
    const warnings: string[] = [];
    if (quotas.monthlyTokenSoftLimit && status.usage.totalTokens >= quotas.monthlyTokenSoftLimit) {
      warnings.push(`Token usage at ${status.tokenUsagePercent.toFixed(1)}% of limit`);
    }
    if (
      quotas.monthlyCostSoftLimitCents &&
      status.usage.totalCostCents >= quotas.monthlyCostSoftLimitCents
    ) {
      warnings.push(`Cost at ${status.costUsagePercent.toFixed(1)}% of limit`);
    }
    warning = warnings.join("; ");
  }

  return { allowed: true, warning };
}

// ============================================================================
// Exports
// ============================================================================

export type { TenantUsageSnapshot, TenantQuotaStatus, QuotaCheckResult };
