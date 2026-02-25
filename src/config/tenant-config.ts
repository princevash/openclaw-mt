/**
 * Tenant configuration overlay system.
 * OPENCLAWMU ADDITION: per-tenant config overlays.
 *
 * Tenants can have their own config overlays that are merged with the base config.
 * Certain keys are admin-only and cannot be set by tenants.
 */

import JSON5 from "json5";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "./types.js";
import { resolveTenantConfigPath } from "../tenants/paths.js";
import { loadConfig } from "./io.js";

/**
 * Keys that are restricted to admin-only and cannot be set in tenant overlays.
 * These include system-wide settings that affect security, authentication, and
 * core infrastructure.
 */
const ADMIN_ONLY_KEYS: (keyof OpenClawConfig)[] = ["gateway", "models", "meta"];

/**
 * Keys within nested objects that are admin-only.
 */
const ADMIN_ONLY_NESTED_KEYS: Record<string, string[]> = {
  agents: ["credentialsPath"],
  env: ["shellEnv"],
};

/**
 * Deep merges two objects, with overlay taking precedence.
 * Arrays are replaced, not merged.
 */
function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(overlay) as (keyof T)[]) {
    const baseValue = base[key];
    const overlayValue = overlay[key];

    if (overlayValue === undefined) {
      continue;
    }

    if (
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof overlayValue === "object" &&
      overlayValue !== null &&
      !Array.isArray(overlayValue)
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overlayValue as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = overlayValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Filters out admin-only keys from a config object.
 */
function filterAdminOnlyKeys(config: Partial<OpenClawConfig>): Partial<OpenClawConfig> {
  const filtered = { ...config };

  for (const key of ADMIN_ONLY_KEYS) {
    delete filtered[key];
  }

  // Filter nested admin-only keys
  for (const [parentKey, nestedKeys] of Object.entries(ADMIN_ONLY_NESTED_KEYS)) {
    const parentValue = filtered[parentKey as keyof OpenClawConfig];
    if (parentValue && typeof parentValue === "object" && !Array.isArray(parentValue)) {
      const filteredParent = { ...parentValue } as Record<string, unknown>;
      for (const nestedKey of nestedKeys) {
        delete filteredParent[nestedKey];
      }
      filtered[parentKey as keyof OpenClawConfig] = filteredParent as never;
    }
  }

  return filtered;
}

/**
 * Loads a tenant's config overlay from their state directory.
 * Returns empty object if the overlay doesn't exist.
 */
export function loadTenantConfigOverlay(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Partial<OpenClawConfig> {
  const configPath = resolveTenantConfigPath(tenantId, env);

  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    // Filter out admin-only keys from the overlay
    return filterAdminOnlyKeys(parsed as Partial<OpenClawConfig>);
  } catch {
    return {};
  }
}

/**
 * Merges base config with tenant overlay.
 * Overlay takes precedence over base config.
 */
export function mergeConfigs(
  base: OpenClawConfig,
  overlay: Partial<OpenClawConfig>,
): OpenClawConfig {
  return deepMerge(base, overlay);
}

/**
 * Loads config for a specific tenant, merging base config with tenant overlay.
 */
export function loadConfigForTenant(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): OpenClawConfig {
  const baseConfig = loadConfig();
  const tenantOverlay = loadTenantConfigOverlay(tenantId, env);
  return mergeConfigs(baseConfig, tenantOverlay);
}

/**
 * Writes a tenant's config overlay.
 * Admin-only keys are filtered out before writing.
 */
export async function writeTenantConfig(
  tenantId: string,
  config: Partial<OpenClawConfig>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const configPath = resolveTenantConfigPath(tenantId, env);

  // Filter out admin-only keys
  const filtered = filterAdminOnlyKeys(config);

  // Ensure directory exists
  const dir = path.dirname(configPath);
  await fs.promises.mkdir(dir, { recursive: true });

  // Write the config
  const json = JSON.stringify(filtered, null, 2).trimEnd().concat("\n");
  await fs.promises.writeFile(configPath, json, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Updates a tenant's config overlay by merging with existing config.
 */
export async function updateTenantConfig(
  tenantId: string,
  updates: Partial<OpenClawConfig>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const existing = loadTenantConfigOverlay(tenantId, env);
  const merged = deepMerge(existing, filterAdminOnlyKeys(updates));
  await writeTenantConfig(tenantId, merged, env);
}

/**
 * Deletes a specific key from a tenant's config overlay.
 */
export async function deleteTenantConfigKey(
  tenantId: string,
  key: keyof OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Don't allow deleting admin-only keys (they shouldn't be there anyway)
  if (ADMIN_ONLY_KEYS.includes(key)) {
    return;
  }

  const existing = loadTenantConfigOverlay(tenantId, env);
  delete existing[key];
  await writeTenantConfig(tenantId, existing, env);
}

/**
 * Gets a list of admin-only config keys that tenants cannot modify.
 */
export function getAdminOnlyKeys(): readonly string[] {
  return ADMIN_ONLY_KEYS;
}
