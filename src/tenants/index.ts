/**
 * Tenant management module for multi-tenancy support.
 * OPENCLAWMU ADDITION: tenant module barrel.
 *
 * @example
 * import { createTenant, validateTenantToken } from "./tenants/index.js";
 *
 * // Create a new tenant
 * const { tenantId, token } = createTenant("demo");
 *
 * // Validate a tenant token
 * const context = validateTenantToken(token);
 * if (context) {
 *   console.log(`Authenticated as tenant: ${context.tenantId}`);
 * }
 */

// Types
export type {
  TenantId,
  TenantContext,
  TenantEntry,
  TenantRegistry,
  CreateTenantResult,
  RemoveTenantOptions,
  TenantTokenFormat,
  TenantQuotas,
  TenantUsageSnapshot,
  TenantQuotaStatus,
  RateLimitState,
  QuotaCheckResult,
} from "./types.js";

export { TENANT_ID_PATTERN, isValidTenantId, parseTenantToken, buildTenantToken } from "./types.js";

// Paths
export {
  resolveTenantStateDir,
  resolveTenantConfigPath,
  resolveTenantWorkspace,
  resolveTenantSessionsDir,
  resolveTenantMemoryDir,
  resolveTenantMemoryPath,
  resolveTenantPluginsDir,
  resolveTenantSandboxDir,
  resolveTenantCredentialsDir,
  resolveTenantBackupsPath,
  resolveTenantRegistryPath,
  resolveTenantUsageDir,
  resolveTenantUsageCurrentPath,
  resolveTenantUsageHistoryPath,
  resolveTenantRateLimitPath,
  resolveSystemMetricsDir,
} from "./paths.js";

// Registry operations
export {
  loadTenantRegistry,
  saveTenantRegistry,
  initializeTenantDirectories,
  createTenant,
  removeTenant,
  rotateTenantToken,
  validateTenantToken,
  getTenant,
  listTenants,
  updateTenant,
  tenantExists,
} from "./registry.js";

// Backup operations
export type { BackupConfig, BackupInfo, BackupResult, RestoreResult } from "./backup.js";

export {
  backupTenantToS3,
  restoreTenantFromS3,
  listTenantBackups,
  deleteTenantBackup,
  pruneTenantBackups,
} from "./backup.js";

// Usage tracking operations
export {
  getCurrentPeriod,
  getQuotaResetTimestamp,
  createEmptyUsageSnapshot,
  loadTenantUsage,
  saveTenantUsage,
  loadTenantUsageHistory,
  updateTokenUsage,
  updateSessionCount,
  updateSandboxUsage,
  calculateTenantDiskUsage,
  updateDiskUsage,
  checkAndRecordRequest,
  getTenantQuotaStatus,
  checkQuotaBeforeRequest,
} from "./usage.js";
