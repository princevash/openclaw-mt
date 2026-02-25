/**
 * Tenant management CLI commands.
 * OPENCLAWMU ADDITION: multi-tenant operator CLI surface.
 *
 * Commands:
 *   openclaw tenants create <tenantId>   - Create a new tenant
 *   openclaw tenants list                - List all tenants
 *   openclaw tenants remove <tenantId>   - Remove a tenant
 *   openclaw tenants token <tenantId>    - Rotate tenant token
 *   openclaw tenants info <tenantId>     - Get tenant information
 */

import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import {
  createTenant,
  removeTenant,
  rotateTenantToken,
  listTenants,
  getTenant,
  isValidTenantId,
  resolveTenantStateDir,
} from "../tenants/index.js";
import { shortenHomePath } from "../utils.js";

export type TenantsCreateOptions = {
  displayName?: string;
  json?: boolean;
};

export type TenantsListOptions = {
  json?: boolean;
};

export type TenantsRemoveOptions = {
  deleteData?: boolean;
  force?: boolean;
};

export type TenantsTokenOptions = {
  json?: boolean;
};

export type TenantsInfoOptions = {
  json?: boolean;
};

/**
 * Creates a new tenant with a generated authentication token.
 */
export async function tenantsCreateCommand(
  tenantId: string,
  opts: TenantsCreateOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  if (!isValidTenantId(tenantId)) {
    runtime.error(
      `Invalid tenant ID: "${String(tenantId)}"\n` +
        "Tenant IDs must:\n" +
        "  - Start with a lowercase letter or number\n" +
        "  - Contain only lowercase letters, numbers, hyphens, and underscores\n" +
        "  - Be 1-32 characters long\n" +
        "Examples: demo, user-123, prod_tenant",
    );
    return;
  }

  try {
    const result = createTenant(tenantId, { displayName: opts.displayName });

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            tenantId: result.tenantId,
            token: result.token,
            createdAt: result.createdAt,
            stateDir: resolveTenantStateDir(result.tenantId),
          },
          null,
          2,
        ),
      );
      return;
    }

    runtime.log(`Tenant created successfully!

Tenant ID: ${result.tenantId}
Token:     ${result.token}
State Dir: ${shortenHomePath(resolveTenantStateDir(result.tenantId))}

To connect as this tenant, use the token in one of these ways:

  1. Environment variable:
     OPENCLAW_GATEWAY_TOKEN="${result.token}" openclaw chat

  2. CLI argument:
     openclaw --remote-token "${result.token}" chat

  3. Config file (gateway.remote.token):
     { "gateway": { "remote": { "token": "${result.token}" } } }

IMPORTANT: Save this token securely. It cannot be retrieved later.
Use "openclaw tenants token ${tenantId}" to rotate if needed.`);
  } catch (err) {
    runtime.error(`Failed to create tenant: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Lists all tenants.
 */
export async function tenantsListCommand(
  opts: TenantsListOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const tenantIds = listTenants();

  if (tenantIds.length === 0) {
    if (opts.json) {
      runtime.log("[]");
      return;
    }
    runtime.log("No tenants found.\n\nCreate one with: openclaw tenants create <tenantId>");
    return;
  }

  const tenants = tenantIds.map((id) => {
    const entry = getTenant(id);
    return {
      tenantId: id,
      displayName: entry?.displayName,
      createdAt: entry?.createdAt,
      lastSeenAt: entry?.lastSeenAt,
      disabled: entry?.disabled,
      stateDir: resolveTenantStateDir(id),
    };
  });

  if (opts.json) {
    runtime.log(JSON.stringify(tenants, null, 2));
    return;
  }

  runtime.log("Tenants:\n");
  for (const tenant of tenants) {
    const status = tenant.disabled ? " (disabled)" : "";
    const name = tenant.displayName ? ` (${tenant.displayName})` : "";
    runtime.log(`  - ${tenant.tenantId}${name}${status}`);
    runtime.log(`    Created: ${tenant.createdAt ?? "unknown"}`);
    if (tenant.lastSeenAt) {
      runtime.log(`    Last seen: ${tenant.lastSeenAt}`);
    }
    runtime.log(`    State: ${shortenHomePath(tenant.stateDir)}`);
    runtime.log("");
  }
}

/**
 * Removes a tenant.
 */
export async function tenantsRemoveCommand(
  tenantId: string,
  opts: TenantsRemoveOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    runtime.error(`Tenant not found: "${tenantId}"`);
    return;
  }

  if (!opts.force) {
    const stateDir = resolveTenantStateDir(tenantId);
    runtime.log(`About to remove tenant: ${tenantId}`);
    if (opts.deleteData) {
      runtime.log(`This will also DELETE all tenant data at: ${shortenHomePath(stateDir)}`);
    }
    runtime.log("\nThis action cannot be undone.");
    runtime.log("Rerun with --force to confirm.");
    return;
  }

  try {
    removeTenant(tenantId, { deleteData: opts.deleteData });
    runtime.log(`Tenant removed: ${tenantId}`);
    if (opts.deleteData) {
      runtime.log("All tenant data has been deleted.");
    }
  } catch (err) {
    runtime.error(`Failed to remove tenant: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Rotates a tenant's authentication token.
 */
export async function tenantsTokenCommand(
  tenantId: string,
  opts: TenantsTokenOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    runtime.error(`Tenant not found: "${tenantId}"`);
    return;
  }

  try {
    const result = rotateTenantToken(tenantId);

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            tenantId: result.tenantId,
            token: result.token,
          },
          null,
          2,
        ),
      );
      return;
    }

    runtime.log(`Token rotated for tenant: ${tenantId}

New Token: ${result.token}

IMPORTANT:
  - The old token is now invalid
  - Update all clients using this tenant's token
  - Save this token securely - it cannot be retrieved later`);
  } catch (err) {
    runtime.error(`Failed to rotate token: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Gets information about a tenant.
 */
export async function tenantsInfoCommand(
  tenantId: string,
  opts: TenantsInfoOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    runtime.error(`Tenant not found: "${tenantId}"`);
    return;
  }

  const stateDir = resolveTenantStateDir(tenantId);
  const info = {
    tenantId,
    displayName: tenant.displayName,
    createdAt: tenant.createdAt,
    lastSeenAt: tenant.lastSeenAt,
    disabled: tenant.disabled,
    stateDir,
  };

  if (opts.json) {
    runtime.log(JSON.stringify(info, null, 2));
    return;
  }

  runtime.log(`Tenant: ${tenantId}`);
  if (tenant.displayName) {
    runtime.log(`Display Name: ${tenant.displayName}`);
  }
  runtime.log(`Created: ${tenant.createdAt}`);
  if (tenant.lastSeenAt) {
    runtime.log(`Last Seen: ${tenant.lastSeenAt}`);
  }
  if (tenant.disabled) {
    runtime.log("Status: DISABLED");
  }
  runtime.log(`State Directory: ${shortenHomePath(stateDir)}`);
}
