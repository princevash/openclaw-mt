/**
 * Admin resource monitoring gateway methods.
 * OPENCLAWMU ADDITION: tenant usage/quota + admin resource APIs.
 *
 * These endpoints are admin-only and provide system-level resource monitoring:
 *   admin.resources.system   - System CPU, memory, disk metrics
 *   admin.resources.tenants  - Per-tenant resource usage summary
 *   admin.resources.history  - Historical system metrics
 *   admin.sandboxes.list     - Active sandboxes
 *   admin.sandboxes.kill     - Kill a sandbox
 *
 * Tenant-level usage endpoints (accessible by tenant or admin):
 *   tenants.usage            - Get tenant's own usage
 *   tenants.quota.status     - Get quota status
 *   tenants.quota.update     - Update quotas (admin only)
 *   tenants.usage.history    - Get usage history
 */

import type { TenantQuotas } from "../../tenants/types.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import {
  collectSystemMetrics,
  getRecentMetrics,
  type TenantResourceSummary,
} from "../../infra/system-metrics.js";
import { listTenants, getTenant, updateTenant } from "../../tenants/registry.js";
import {
  loadTenantUsage,
  loadTenantUsageHistory,
  getTenantQuotaStatus,
  updateDiskUsage,
} from "../../tenants/usage.js";
import { errorShape, ErrorCodes } from "../protocol/index.js";

// ============================================================================
// Authorization Helpers
// ============================================================================

/**
 * Checks if the client has admin scope.
 */
function hasAdminScope(opts: GatewayRequestHandlerOptions): boolean {
  const scopes = opts.client?.connect?.scopes ?? [];
  return scopes.includes("operator.admin");
}

/**
 * Checks if the client can access a specific tenant.
 */
function canAccessTenant(opts: GatewayRequestHandlerOptions, tenantId: string): boolean {
  if (hasAdminScope(opts)) {
    return true;
  }
  return opts.client?.tenantId === tenantId;
}

// ============================================================================
// Tenant Usage Handlers
// ============================================================================

/**
 * Tenant usage and quota management handlers.
 */
export const tenantUsageHandlers: GatewayRequestHandlers = {
  /**
   * Gets usage for a tenant.
   * Admin can access any tenant, tenant can access own.
   */
  "tenants.usage": async (opts) => {
    const params = opts.params as { tenantId?: string; refreshDisk?: boolean };
    const tenantId = params.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"),
      );
      return;
    }

    if (!canAccessTenant(opts, tenantId)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      // Optionally refresh disk usage (expensive)
      if (params.refreshDisk) {
        await updateDiskUsage(tenantId);
      }

      const usage = await loadTenantUsage(tenantId);
      opts.respond(true, usage);
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Gets quota status for a tenant.
   * Shows current usage vs limits and whether tenant is blocked.
   */
  "tenants.quota.status": async (opts) => {
    const params = opts.params as { tenantId?: string };
    const tenantId = params.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"),
      );
      return;
    }

    if (!canAccessTenant(opts, tenantId)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      const tenant = getTenant(tenantId);
      if (!tenant) {
        opts.respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Tenant not found"));
        return;
      }

      const quotas = tenant.quotas ?? {};
      const status = await getTenantQuotaStatus(tenantId, quotas);
      opts.respond(true, status);
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Updates quotas for a tenant.
   * Requires admin scope.
   */
  "tenants.quota.update": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    const params = opts.params as { tenantId?: string; quotas?: TenantQuotas };
    const tenantId = params.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"),
      );
      return;
    }

    if (!params.quotas || typeof params.quotas !== "object") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "quotas object is required"),
      );
      return;
    }

    try {
      const tenant = getTenant(tenantId);
      if (!tenant) {
        opts.respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Tenant not found"));
        return;
      }

      // Merge new quotas with existing
      const existingQuotas = tenant.quotas ?? {};
      const newQuotas = { ...existingQuotas, ...params.quotas };

      updateTenant(tenantId, { quotas: newQuotas });
      opts.respond(true, { updated: true, tenantId, quotas: newQuotas });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Gets usage history for a tenant.
   * Returns monthly snapshots.
   */
  "tenants.usage.history": async (opts) => {
    const params = opts.params as { tenantId?: string; months?: number };
    const tenantId = params.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenantId is required"),
      );
      return;
    }

    if (!canAccessTenant(opts, tenantId)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Access denied"));
      return;
    }

    try {
      const months = params.months ?? 6;
      const history = await loadTenantUsageHistory(tenantId, months);
      opts.respond(true, { history });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};

// ============================================================================
// Admin Resource Handlers
// ============================================================================

// Cache for expensive tenant aggregation
let tenantSummaryCache: {
  timestamp: number;
  summaries: TenantResourceSummary[];
} | null = null;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Builds a summary for all tenants.
 */
async function getAllTenantSummaries(
  sortBy: string = "tokensUsed",
  limit: number = 50,
): Promise<TenantResourceSummary[]> {
  const now = Date.now();

  // Check cache
  if (tenantSummaryCache && now - tenantSummaryCache.timestamp < CACHE_TTL_MS) {
    const cached = [...tenantSummaryCache.summaries];
    return sortAndLimit(cached, sortBy, limit);
  }

  const tenantIds = listTenants();
  const summaries: TenantResourceSummary[] = [];

  for (const tenantId of tenantIds) {
    try {
      const tenant = getTenant(tenantId);
      const usage = await loadTenantUsage(tenantId);
      const quotas = tenant?.quotas ?? {};

      const tokenLimit = quotas.monthlyTokenLimit;
      const costLimitCents = quotas.monthlyCostLimitCents;
      const diskLimitBytes = quotas.diskSpaceLimitBytes;

      const isOverTokenLimit = tokenLimit ? usage.totalTokens >= tokenLimit : false;
      const isOverCostLimit = costLimitCents ? usage.totalCostCents >= costLimitCents : false;
      const isOverDiskLimit = diskLimitBytes ? usage.diskUsageBytes >= diskLimitBytes : false;

      summaries.push({
        tenantId,
        displayName: tenant?.displayName,
        tokensUsed: usage.totalTokens,
        tokenLimit,
        tokenUsagePercent: tokenLimit ? (usage.totalTokens / tokenLimit) * 100 : 0,
        costCents: usage.totalCostCents,
        costLimitCents,
        costUsagePercent: costLimitCents ? (usage.totalCostCents / costLimitCents) * 100 : 0,
        diskUsageBytes: usage.diskUsageBytes,
        diskLimitBytes,
        diskUsagePercent: diskLimitBytes ? (usage.diskUsageBytes / diskLimitBytes) * 100 : 0,
        activeSessions: usage.activeSessions,
        totalSessions: usage.totalSessions,
        isOverQuota: isOverTokenLimit || isOverCostLimit || isOverDiskLimit,
        isBlocked: tenant?.disabled ?? false,
        lastActiveAt: tenant?.lastSeenAt ? new Date(tenant.lastSeenAt).getTime() : undefined,
      });
    } catch {
      // Skip tenants with errors
    }
  }

  // Update cache
  tenantSummaryCache = { timestamp: now, summaries };

  return sortAndLimit(summaries, sortBy, limit);
}

/**
 * Sorts and limits tenant summaries.
 */
function sortAndLimit(
  summaries: TenantResourceSummary[],
  sortBy: string,
  limit: number,
): TenantResourceSummary[] {
  const sorted = summaries.toSorted((a, b) => {
    switch (sortBy) {
      case "tokensUsed":
        return b.tokensUsed - a.tokensUsed;
      case "costCents":
        return b.costCents - a.costCents;
      case "diskUsageBytes":
        return b.diskUsageBytes - a.diskUsageBytes;
      case "activeSessions":
        return b.activeSessions - a.activeSessions;
      case "lastActiveAt":
        return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
      default:
        return b.tokensUsed - a.tokensUsed;
    }
  });

  return sorted.slice(0, limit);
}

/**
 * Admin resource monitoring handlers.
 */
export const adminResourceHandlers: GatewayRequestHandlers = {
  /**
   * Gets system resource snapshot.
   * Returns CPU, memory, disk, and process metrics.
   */
  "admin.resources.system": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    try {
      // Get active connections and sandboxes from context if available
      const activeConnections = opts.context?.getActiveConnectionCount?.() ?? 0;
      const activeSandboxes = opts.context?.getActiveSandboxCount?.() ?? 0;

      const snapshot = await collectSystemMetrics({
        activeConnections,
        activeSandboxes,
        includeTenantsAggregate: true,
      });

      opts.respond(true, snapshot);
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Gets resource summary for all tenants.
   * Supports sorting and pagination.
   */
  "admin.resources.tenants": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    const params = opts.params as { sortBy?: string; limit?: number };

    try {
      const sortBy = params.sortBy ?? "tokensUsed";
      const limit = params.limit ?? 50;
      const summaries = await getAllTenantSummaries(sortBy, limit);

      // Compute aggregates
      const tenantIds = listTenants();
      const aggregates = {
        totalCount: tenantIds.length,
        overQuotaCount: summaries.filter((s) => s.isOverQuota).length,
        blockedCount: summaries.filter((s) => s.isBlocked).length,
        totalDiskUsageBytes: summaries.reduce((sum, s) => sum + s.diskUsageBytes, 0),
        totalTokensUsed: summaries.reduce((sum, s) => sum + s.tokensUsed, 0),
        totalCostCents: summaries.reduce((sum, s) => sum + s.costCents, 0),
      };

      opts.respond(true, { tenants: summaries, aggregates });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Gets historical system metrics.
   * Returns time series data.
   */
  "admin.resources.history": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    const params = opts.params as { hours?: number; resolution?: string };

    try {
      const hours = params.hours ?? 24;
      const resolution = (params.resolution ?? "5m") as "30s" | "1m" | "5m" | "15m" | "1h";
      const history = getRecentMetrics(hours, resolution);

      opts.respond(true, {
        history,
        sampleCount: history.length,
        resolution,
        hoursRequested: hours,
      });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Lists active sandboxes.
   * Returns sandbox IDs, tenant associations, and resource usage.
   */
  "admin.sandboxes.list": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    try {
      // Get active sandboxes from context if available
      const sandboxes = opts.context?.getActiveSandboxes?.() ?? [];
      opts.respond(true, { sandboxes });
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  /**
   * Kills an active sandbox.
   * Terminates the sandbox process.
   */
  "admin.sandboxes.kill": async (opts) => {
    if (!hasAdminScope(opts)) {
      opts.respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Admin access required"));
      return;
    }

    const params = opts.params as { sandboxId?: string };

    if (!params.sandboxId || typeof params.sandboxId !== "string") {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sandboxId is required"),
      );
      return;
    }

    try {
      // Kill sandbox through context if available
      const killed = await opts.context?.killSandbox?.(params.sandboxId);
      if (killed) {
        opts.respond(true, { killed: true, sandboxId: params.sandboxId });
      } else {
        opts.respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, "Sandbox not found or already terminated"),
        );
      }
    } catch (err) {
      opts.respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};

// ============================================================================
// Exports
// ============================================================================

/**
 * Combined handlers for registration.
 */
export const allResourceHandlers: GatewayRequestHandlers = {
  ...tenantUsageHandlers,
  ...adminResourceHandlers,
};

/**
 * List of method names for registration.
 */
export const RESOURCE_METHODS = Object.keys(allResourceHandlers);
