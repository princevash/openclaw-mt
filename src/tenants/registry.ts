/**
 * Tenant registry management.
 * OPENCLAWMU ADDITION: tenant CRUD + token validation.
 *
 * Handles tenant CRUD operations, token generation, and validation.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  resolveTenantRegistryPath,
  resolveTenantStateDir,
  resolveTenantWorkspace,
  resolveTenantSessionsDir,
  resolveTenantMemoryDir,
  resolveTenantPluginsDir,
  resolveTenantSandboxDir,
  resolveTenantCredentialsDir,
} from "./paths.js";
import {
  type TenantId,
  type TenantEntry,
  type TenantRegistry,
  type TenantContext,
  type CreateTenantResult,
  type RemoveTenantOptions,
  type TenantQuotas,
  isValidTenantId,
  parseTenantToken,
  buildTenantToken,
} from "./types.js";

const TOKEN_BYTES = 32;
const EMPTY_REGISTRY: TenantRegistry = { version: 1, tenants: {} };

/**
 * Generates a cryptographically secure random token.
 */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Hashes a token using SHA-256.
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe comparison of token hashes.
 */
function safeEqualHash(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Loads the tenant registry from disk.
 * Returns empty registry if file doesn't exist.
 */
export function loadTenantRegistry(env: NodeJS.ProcessEnv = process.env): TenantRegistry {
  const registryPath = resolveTenantRegistryPath(env);
  try {
    if (!fs.existsSync(registryPath)) {
      return { ...EMPTY_REGISTRY };
    }
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as TenantRegistry;
    if (parsed?.version !== 1 || typeof parsed.tenants !== "object") {
      return { ...EMPTY_REGISTRY };
    }
    return parsed;
  } catch {
    return { ...EMPTY_REGISTRY };
  }
}

/**
 * Saves the tenant registry to disk.
 */
export function saveTenantRegistry(
  registry: TenantRegistry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const registryPath = resolveTenantRegistryPath(env);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(registryPath, 0o600);
  } catch {
    // best-effort
  }
}

/**
 * Creates the directory structure for a tenant.
 */
export function initializeTenantDirectories(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const dirs = [
    resolveTenantStateDir(tenantId, env),
    resolveTenantWorkspace(tenantId, env),
    resolveTenantSessionsDir(tenantId, "main", env),
    resolveTenantMemoryDir(tenantId, env),
    resolveTenantPluginsDir(tenantId, env),
    resolveTenantSandboxDir(tenantId, env),
    resolveTenantCredentialsDir(tenantId, env),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Creates a new tenant with a generated authentication token.
 * @throws Error if tenant ID is invalid or already exists
 */
export function createTenant(
  tenantId: TenantId,
  options?: { displayName?: string },
  env: NodeJS.ProcessEnv = process.env,
): CreateTenantResult {
  if (!isValidTenantId(tenantId)) {
    throw new Error(
      `Invalid tenant ID: "${String(tenantId)}". Must match pattern: lowercase alphanumeric, hyphens, underscores, 1-32 chars.`,
    );
  }

  const registry = loadTenantRegistry(env);
  if (registry.tenants[tenantId]) {
    throw new Error(`Tenant already exists: "${tenantId}"`);
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const createdAt = new Date().toISOString();

  const entry: TenantEntry = {
    tokenHash,
    createdAt,
    displayName: options?.displayName,
  };

  registry.tenants[tenantId] = entry;
  saveTenantRegistry(registry, env);
  initializeTenantDirectories(tenantId, env);

  return {
    tenantId,
    token: buildTenantToken(tenantId, token),
    createdAt,
  };
}

/**
 * Removes a tenant from the registry.
 * @param deleteData - If true, also deletes all tenant data files
 */
export function removeTenant(
  tenantId: TenantId,
  options?: RemoveTenantOptions,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const registry = loadTenantRegistry(env);
  if (!registry.tenants[tenantId]) {
    throw new Error(`Tenant not found: "${tenantId}"`);
  }

  delete registry.tenants[tenantId];
  saveTenantRegistry(registry, env);

  if (options?.deleteData) {
    const tenantDir = resolveTenantStateDir(tenantId, env);
    if (fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }
  }
}

/**
 * Rotates a tenant's authentication token.
 * Returns the new token (only time it's available in plaintext).
 */
export function rotateTenantToken(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): { tenantId: TenantId; token: string } {
  const registry = loadTenantRegistry(env);
  const entry = registry.tenants[tenantId];
  if (!entry) {
    throw new Error(`Tenant not found: "${tenantId}"`);
  }

  const newToken = generateToken();
  entry.tokenHash = hashToken(newToken);
  saveTenantRegistry(registry, env);

  return {
    tenantId,
    token: buildTenantToken(tenantId, newToken),
  };
}

/**
 * Validates a tenant token and returns the tenant context if valid.
 * Updates lastSeenAt on successful validation.
 */
export function validateTenantToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): TenantContext | null {
  const parsed = parseTenantToken(token);
  if (!parsed) {
    return null;
  }

  const { tenantId, secret } = parsed;
  const registry = loadTenantRegistry(env);
  const entry = registry.tenants[tenantId];
  if (!entry) {
    return null;
  }

  if (entry.disabled) {
    return null;
  }

  const providedHash = hashToken(secret);
  if (!safeEqualHash(providedHash, entry.tokenHash)) {
    return null;
  }

  // Update lastSeenAt
  entry.lastSeenAt = new Date().toISOString();
  saveTenantRegistry(registry, env);

  return {
    tenantId,
    tokenHash: entry.tokenHash,
    stateDir: resolveTenantStateDir(tenantId, env),
    createdAt: entry.createdAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

/**
 * Gets tenant information without validating a token.
 * For admin use only.
 */
export function getTenant(
  tenantId: TenantId,
  env: NodeJS.ProcessEnv = process.env,
): TenantEntry | null {
  const registry = loadTenantRegistry(env);
  return registry.tenants[tenantId] ?? null;
}

/**
 * Lists all tenant IDs.
 */
export function listTenants(env: NodeJS.ProcessEnv = process.env): TenantId[] {
  const registry = loadTenantRegistry(env);
  return Object.keys(registry.tenants);
}

/**
 * Updates tenant properties (displayName, disabled, quotas).
 */
export function updateTenant(
  tenantId: TenantId,
  updates: { displayName?: string; disabled?: boolean; quotas?: TenantQuotas },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const registry = loadTenantRegistry(env);
  const entry = registry.tenants[tenantId];
  if (!entry) {
    throw new Error(`Tenant not found: "${tenantId}"`);
  }

  if (updates.displayName !== undefined) {
    entry.displayName = updates.displayName || undefined;
  }
  if (updates.disabled !== undefined) {
    entry.disabled = updates.disabled || undefined;
  }
  if (updates.quotas !== undefined) {
    entry.quotas = updates.quotas;
  }

  saveTenantRegistry(registry, env);
}

/**
 * Checks if a tenant exists.
 */
export function tenantExists(tenantId: TenantId, env: NodeJS.ProcessEnv = process.env): boolean {
  const registry = loadTenantRegistry(env);
  return tenantId in registry.tenants;
}
