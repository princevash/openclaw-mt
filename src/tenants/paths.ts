/**
 * Tenant-specific path resolution utilities.
 * OPENCLAWMU ADDITION: per-tenant state directory layout.
 *
 * All tenant data is isolated under {stateDir}/tenants/{tenantId}/.
 */

import path from "node:path";
import type { TenantId } from "./types.js";
import { resolveStateDir } from "../config/paths.js";

/**
 * Resolves the base state directory for a tenant.
 * Returns the root state directory if tenantId is undefined (backward compat).
 *
 * @param tenantId - The tenant identifier (optional for backward compat)
 * @param env - Environment variables (optional)
 * @returns Absolute path to tenant's state directory
 *
 * @example
 * resolveTenantStateDir("demo") // ~/.openclaw/tenants/demo
 * resolveTenantStateDir(undefined) // ~/.openclaw
 */
export function resolveTenantStateDir(
  tenantId: TenantId | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const baseDir = resolveStateDir(env);
  if (!tenantId) {
    return baseDir;
  }
  return path.join(baseDir, "tenants", tenantId);
}

/**
 * Resolves the config file path for a tenant.
 * Tenants can have config overlays at {tenantDir}/openclaw.json.
 */
export function resolveTenantConfigPath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "openclaw.json");
}

/**
 * Resolves the workspace directory for a tenant.
 * This is the working directory mounted inside the sandbox at /workspace.
 */
export function resolveTenantWorkspace(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "workspace");
}

/**
 * Resolves the sessions directory for a tenant and agent.
 */
export function resolveTenantSessionsDir(
  tenantId: TenantId,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "agents", agentId, "sessions");
}

/**
 * Resolves the memory database directory for a tenant.
 */
export function resolveTenantMemoryDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "memory");
}

/**
 * Resolves the memory database path for a tenant and agent.
 */
export function resolveTenantMemoryPath(
  tenantId: TenantId,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantMemoryDir(tenantId, env), `${agentId}.sqlite`);
}

/**
 * Resolves the plugins directory for a tenant.
 */
export function resolveTenantPluginsDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "plugins");
}

/**
 * Resolves the sandbox state directory for a tenant.
 */
export function resolveTenantSandboxDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "sandboxes");
}

/**
 * Resolves the credentials directory for a tenant.
 */
export function resolveTenantCredentialsDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "credentials");
}

/**
 * Resolves the backups metadata file for a tenant.
 */
export function resolveTenantBackupsPath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "backups.json");
}

/**
 * Resolves the tenant registry file path.
 * This is stored at the root state directory level, not per-tenant.
 */
export function resolveTenantRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "tenants.json");
}

/**
 * Resolves the usage tracking directory for a tenant.
 */
export function resolveTenantUsageDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "usage");
}

/**
 * Resolves the current usage snapshot file for a tenant.
 */
export function resolveTenantUsageCurrentPath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantUsageDir(tenantId, env), "current.json");
}

/**
 * Resolves the usage history file for a specific period (YYYY-MM).
 */
export function resolveTenantUsageHistoryPath(
  tenantId: TenantId,
  period: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantUsageDir(tenantId, env), `${period}.json`);
}

/**
 * Resolves the rate limit state file for a tenant.
 */
export function resolveTenantRateLimitPath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantUsageDir(tenantId, env), "rate-limits.json");
}

/**
 * Resolves the system metrics directory.
 */
export function resolveSystemMetricsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "metrics");
}

/**
 * Resolves the cron jobs directory for a tenant.
 */
export function resolveTenantCronDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "cron");
}

/**
 * Resolves the cron jobs store path for a tenant.
 */
export function resolveTenantCronStorePath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantCronDir(tenantId, env), "jobs.json");
}

/**
 * Resolves the settings directory for a tenant.
 */
export function resolveTenantSettingsDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "settings");
}

/**
 * Resolves the voice wake config path for a tenant.
 */
export function resolveTenantVoiceWakePath(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantSettingsDir(tenantId, env), "voicewake.json");
}

/**
 * Resolves the agents directory for a tenant.
 */
export function resolveTenantAgentsDir(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantStateDir(tenantId, env), "agents");
}

/**
 * Resolves a specific agent's directory for a tenant.
 */
export function resolveTenantAgentDir(
  tenantId: TenantId,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantAgentsDir(tenantId, env), agentId);
}

/**
 * Resolves an agent's workspace directory for a tenant.
 */
export function resolveTenantAgentWorkspaceDir(
  tenantId: TenantId,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantAgentDir(tenantId, agentId, env), "workspace");
}

/**
 * Resolves a channel credential file path for a tenant.
 */
export function resolveTenantChannelCredentialsPath(
  tenantId: TenantId,
  channelId: string,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantCredentialsDir(tenantId, env), `${channelId}-${accountId}.json`);
}
