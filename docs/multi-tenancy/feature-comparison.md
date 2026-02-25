# Multi-Tenancy vs Default OpenClaw - Feature Comparison

This document explicitly maps the differences between default (single-operator) OpenClaw and multi-tenant OpenClaw, documenting all limitations for tenant tokens.

## Authentication Modes

| Mode                          | Token Type                             | Capabilities                                |
| ----------------------------- | -------------------------------------- | ------------------------------------------- |
| **Default (Single Operator)** | Gateway token or password              | Full system access                          |
| **Multi-Tenant (Admin)**      | Gateway token + `operator.admin` scope | Full system access + tenant management      |
| **Multi-Tenant (Tenant)**     | `tenant:{tenantId}:{secret}` format    | Restricted to own sandbox + self-management |

## Feature Availability Matrix

### Legend

- **Full** - Complete access
- **Self** - Own resources only
- **None** - Not available

| Feature Category     | Default Mode | Multi-Tenant Admin | Multi-Tenant Tenant |
| -------------------- | ------------ | ------------------ | ------------------- |
| **Configuration**    | Full         | Full               | Self (overlay)      |
| **Agent Management** | Full         | Full               | Self                |
| **Session Control**  | Full         | Full               | Self (read-only)    |
| **Terminal Access**  | Full         | Full               | Self                |
| **Canvas/UI**        | Full         | Full               | Self                |
| **Cron Jobs**        | Full         | Full               | Self                |
| **Skills**           | Full         | Full               | Self                |
| **Channels**         | Full         | Full               | Self                |
| **Pairing**          | Full         | Full               | Self                |
| **Backups**          | N/A          | Full               | Self                |
| **Usage/Quotas**     | N/A          | Full               | Self                |

## Detailed Feature Breakdown

### 1. Terminal Access

| Operation         | Default | Admin     | Tenant             |
| ----------------- | ------- | --------- | ------------------ |
| `terminal.spawn`  | Yes     | Yes       | Yes (own sandbox)  |
| `terminal.write`  | Yes     | Yes       | Yes (own sessions) |
| `terminal.resize` | Yes     | Yes       | Yes (own sessions) |
| `terminal.close`  | Yes     | Yes       | Yes (own sessions) |
| `terminal.list`   | Yes     | Yes (all) | Yes (own only)     |

**Tenant Limitation:** Tenants can only spawn terminals in their own sandbox (`~/.openclaw/tenants/{tenantId}/workspace`).

### 2. Configuration Management

| Operation       | Default | Admin | Tenant              |
| --------------- | ------- | ----- | ------------------- |
| `config.get`    | Yes     | Yes   | Yes (merged config) |
| `config.set`    | Yes     | Yes   | Yes (overlay only)  |
| `config.patch`  | Yes     | Yes   | Yes (overlay only)  |
| `config.apply`  | Yes     | Yes   | **No**              |
| `config.schema` | Yes     | Yes   | Yes                 |

**Tenant Capabilities:**

- `config.get` returns the merged config (base + tenant overlay)
- `config.set/patch` write to the tenant's overlay at `{tenantDir}/openclaw.json`
- Admin-only keys (gateway, providers, meta) are filtered from tenant writes
- Tenants cannot trigger gateway restarts via config changes

### 3. Agent Management

| Operation           | Default | Admin | Tenant                   |
| ------------------- | ------- | ----- | ------------------------ |
| `agents.list`       | Yes     | Yes   | Yes (from merged config) |
| `agents.create`     | Yes     | Yes   | Yes (tenant-isolated)    |
| `agents.update`     | Yes     | Yes   | Yes (tenant-isolated)    |
| `agents.delete`     | Yes     | Yes   | Yes (tenant-isolated)    |
| `agents.files.list` | Yes     | Yes   | Yes (tenant-isolated)    |
| `agents.files.get`  | Yes     | Yes   | Yes (tenant-isolated)    |
| `agents.files.set`  | Yes     | Yes   | Yes (tenant-isolated)    |
| `agent` (chat)      | Yes     | Yes   | **No**                   |
| `agent.identity.*`  | Yes     | Yes   | **No**                   |

**Tenant Capabilities:**

- `agents.list` returns agents defined in the tenant's merged config (base + overlay)
- Tenants can create, update, and delete their own agents
- Agent files are stored in the tenant's isolated directory
- Tenants can interact with agents via the terminal interface

### 4. Session Management

| Operation          | Default | Admin | Tenant             |
| ------------------ | ------- | ----- | ------------------ |
| `sessions.list`    | Yes     | Yes   | Yes (own sessions) |
| `sessions.preview` | Yes     | Yes   | Yes (own sessions) |
| `sessions.patch`   | Yes     | Yes   | **No**             |
| `sessions.reset`   | Yes     | Yes   | **No**             |
| `sessions.delete`  | Yes     | Yes   | **No**             |
| `sessions.compact` | Yes     | Yes   | **No**             |

**Tenant Capabilities:**

- `sessions.list` returns only sessions prefixed with `tenant:{tenantId}:`
- `sessions.preview` only allows previewing own tenant's sessions
- Session keys are automatically namespaced with tenant prefix at API entry points

### 5. Cron Jobs

| Operation     | Default | Admin | Tenant                |
| ------------- | ------- | ----- | --------------------- |
| `cron.list`   | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.add`    | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.update` | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.remove` | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.run`    | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.status` | Yes     | Yes   | Yes (tenant-isolated) |
| `cron.runs`   | Yes     | Yes   | Yes (tenant-isolated) |

**Tenant Capabilities:**

- Tenants have full cron job management with auto-scheduling
- Jobs are stored in `{tenantDir}/cron/jobs.json`
- Tenant-isolated cron service handles scheduling

### 6. Skills & Plugins

| Operation        | Default | Admin | Tenant                |
| ---------------- | ------- | ----- | --------------------- |
| `skills.status`  | Yes     | Yes   | Yes (tenant-isolated) |
| `skills.bins`    | Yes     | Yes   | Yes (tenant-isolated) |
| `skills.install` | Yes     | Yes   | Yes (tenant-isolated) |
| `skills.update`  | Yes     | Yes   | Yes (tenant-isolated) |

**Tenant Capabilities:**

- Tenants can install and manage skills within their workspace
- Skills are installed in `{tenantDir}/workspace/`
- Binary requirements tracked per skill

### 7. Channel Operations

| Operation         | Default | Admin | Tenant                |
| ----------------- | ------- | ----- | --------------------- |
| `channels.status` | Yes     | Yes   | Yes (tenant-isolated) |
| `channels.start`  | Yes     | Yes   | Yes (tenant-isolated) |
| `channels.stop`   | Yes     | Yes   | Yes (tenant-isolated) |
| `channels.logout` | Yes     | Yes   | Yes (tenant-isolated) |
| `send` (message)  | Yes     | Yes   | **No**                |
| `chat.send`       | Yes     | Yes   | **No**                |

**Tenant Capabilities:**

- Tenants can manage their own channel connections (start, stop, logout)
- Direct message sending (`send`, `chat.send`) requires admin scope

### 8. Device & Node Pairing

| Operation             | Default | Admin | Tenant                |
| --------------------- | ------- | ----- | --------------------- |
| `device.pair.list`    | Yes     | Yes   | Yes (tenant-isolated) |
| `device.pair.approve` | Yes     | Yes   | Yes (tenant-isolated) |
| `device.pair.reject`  | Yes     | Yes   | Yes (tenant-isolated) |
| `device.token.rotate` | Yes     | Yes   | Yes (tenant-isolated) |
| `device.token.revoke` | Yes     | Yes   | Yes (tenant-isolated) |
| `node.pair.request`   | Yes     | Yes   | Yes (tenant-isolated) |
| `node.pair.list`      | Yes     | Yes   | Yes (tenant-isolated) |
| `node.pair.approve`   | Yes     | Yes   | Yes (tenant-isolated) |
| `node.pair.reject`    | Yes     | Yes   | Yes (tenant-isolated) |
| `node.pair.verify`    | Yes     | Yes   | Yes (tenant-isolated) |
| `node.rename`         | Yes     | Yes   | Yes (tenant-isolated) |
| `node.list`           | Yes     | Yes   | Yes (tenant-isolated) |
| `node.describe`       | Yes     | Yes   | Yes (tenant-isolated) |
| `node.invoke`         | Yes     | Yes   | Yes (tenant-isolated) |

**Tenant Capabilities:**

- Tenants can pair and manage their own devices and nodes
- All device/node operations are tenant-isolated

### 9. Canvas/UI Access

| Resource          | Default | Admin | Tenant              |
| ----------------- | ------- | ----- | ------------------- |
| `/a2ui/*`         | Yes     | Yes   | Yes (tenant-scoped) |
| `/canvas-host/*`  | Yes     | Yes   | Yes (tenant-scoped) |
| `/canvas/ws`      | Yes     | Yes   | Yes (tenant-scoped) |
| Bearer token auth | Yes     | Yes   | Yes                 |

**Tenant Capabilities:**

- Tenants can access canvas UI with tenant-scoped resources

### 10. Tenant Self-Management

| Operation                | Default | Admin     | Tenant                   |
| ------------------------ | ------- | --------- | ------------------------ |
| `tenants.list`           | N/A     | Yes       | **No**                   |
| `tenants.create`         | N/A     | Yes       | **No**                   |
| `tenants.get`            | N/A     | Yes (all) | Yes (self)               |
| `tenants.delete`         | N/A     | Yes       | Yes (self, with confirm) |
| `tenants.update`         | N/A     | Yes       | **No**                   |
| `tenants.rotate`         | N/A     | Yes (all) | Yes (self)               |
| `tenants.backup`         | N/A     | Yes (all) | Yes (self)               |
| `tenants.backups.list`   | N/A     | Yes (all) | Yes (self)               |
| `tenants.backups.delete` | N/A     | Yes       | **No**                   |
| `tenants.restore`        | N/A     | Yes       | Yes (self only)          |
| `tenants.usage`          | N/A     | Yes (all) | Yes (self)               |
| `tenants.quota.status`   | N/A     | Yes (all) | Yes (self)               |
| `tenants.usage.history`  | N/A     | Yes (all) | Yes (self)               |

**Tenant Capabilities:**

- `tenants.delete` allows self-deletion with `confirm: true` (always deletes data)
- `tenants.restore` allows restoring own backups (cannot use `createIfMissing`)
- Cannot enumerate other tenants or delete backups

### 11. Voice Wake

| Operation       | Default | Admin | Tenant                |
| --------------- | ------- | ----- | --------------------- |
| `voicewake.get` | Yes     | Yes   | Yes (tenant-isolated) |
| `voicewake.set` | Yes     | Yes   | Yes (tenant-isolated) |

**Tenant Capabilities:**

- Tenants can configure voice wake settings for their sandbox

### 12. System Operations

| Operation      | Default | Admin | Tenant |
| -------------- | ------- | ----- | ------ |
| `health`       | Yes     | Yes   | Yes    |
| `status`       | Yes     | Yes   | **No** |
| `logs.tail`    | Yes     | Yes   | **No** |
| `models.list`  | Yes     | Yes   | **No** |
| `usage.status` | Yes     | Yes   | **No** |
| `update.run`   | Yes     | Yes   | **No** |
| `wizard.*`     | Yes     | Yes   | **No** |

**Tenant Limitation:** Tenants can only call `health`. All other system operations are blocked.

## Data Isolation

### Default Mode Storage

```
~/.openclaw/
├── openclaw.json5       # Main configuration
├── sessions/            # Session transcripts
├── agents/              # Agent workspaces
├── cron/                # Cron jobs
├── media/               # Media cache
└── logs/                # Log files
```

### Multi-Tenant Storage

```
~/.openclaw/
├── tenants.json         # Tenant registry (admin only)
├── metrics/             # System-wide metrics (admin only)
└── tenants/
    └── {tenantId}/
        ├── workspace/   # Mounted at /workspace in sandbox
        ├── agents/      # Per-tenant agent sessions
        │   └── {agentId}/sessions/
        ├── memory/      # Per-tenant SQLite databases
        │   └── {agentId}.sqlite
        ├── plugins/     # Per-tenant plugins
        ├── sandboxes/   # Per-tenant sandbox state
        ├── credentials/ # Per-tenant credentials
        ├── usage/       # Per-tenant usage tracking
        │   ├── current.json
        │   └── {YYYY-MM}.json
        └── openclaw.json # Tenant config overlay (not API-exposed)
```

### Isolation Guarantees

- File system paths are validated with tenant ID regex (`^[a-z0-9][a-z0-9_-]{0,31}$`)
- Session keys are auto-prefixed with `tenant:{tenantId}:` at HTTP entry points
- SQLite databases are per-tenant-per-agent
- Sandbox processes run in user namespaces with tenant-specific workspaces

## Quota System (Tenant Only)

| Quota                       | Type     | Description                  |
| --------------------------- | -------- | ---------------------------- |
| `monthlyTokenLimit`         | Hard     | Block requests when exceeded |
| `monthlyTokenSoftLimit`     | Soft     | Warning threshold            |
| `monthlyCostLimitCents`     | Hard     | Block on cost exceeded       |
| `monthlyCostSoftLimitCents` | Soft     | Warning threshold            |
| `diskSpaceLimitBytes`       | Hard     | Limit workspace size         |
| `maxConcurrentSessions`     | Hard     | Limit active sessions        |
| `requestsPerMinute`         | Rate     | API rate limiting            |
| `requestsPerHour`           | Rate     | API rate limiting            |
| `maxSandboxCpuPercent`      | Resource | CPU limit (100 = 1 core)     |
| `maxSandboxMemoryMB`        | Resource | Memory limit                 |
| `maxSandboxDiskMB`          | Resource | Sandbox disk limit           |
| `maxSandboxPids`            | Resource | Max processes                |

**Note:** Quotas only apply to tenants. Default mode has no built-in quotas.

## Scope Comparison

### Default Mode Scopes

| Scope                | Purpose                     |
| -------------------- | --------------------------- |
| `operator.admin`     | Full system access          |
| `operator.read`      | Read-only operations        |
| `operator.write`     | Read + write operations     |
| `operator.approvals` | Execution approval handling |
| `operator.pairing`   | Device/node pairing         |

### Tenant Token Scopes

Tenant tokens do **not** use the scope system. Authorization is based solely on:

1. Is it a tenant token? (`client.tenantId` is set)
2. Is the method in `TENANT_ALLOWED_METHODS`?
3. Does the tenant own the resource? (`canAccessTenant()`)

## Summary: What Tenants CAN Do

1. **Terminal Access** - Spawn and interact with terminals in their sandbox
2. **Configuration** - Read merged config, write to their overlay
3. **Agent Management** - Create, update, delete, and manage agent files
4. **Session Access** - List and preview their own sessions
5. **Cron Jobs** - Full cron job management with auto-scheduling
6. **Skills** - Install and manage skills in their workspace
7. **Channels** - Start, stop, and manage channel connections
8. **Voice Wake** - Configure voice wake settings
9. **Device/Node Pairing** - Pair and manage devices and nodes
10. **Canvas/UI** - Access canvas UI with tenant-scoped resources
11. **View Usage** - Check token usage, costs, quota status
12. **Backup Data** - Export tenant data to S3-compatible storage
13. **List Backups** - Enumerate their own backups
14. **Restore Backups** - Restore their own backups
15. **Rotate Token** - Generate a new authentication token
16. **Get Info** - Retrieve their tenant metadata
17. **Self-Delete** - Delete their own tenant (with confirmation)
18. **Health Check** - Call the health endpoint

## Summary: What Tenants CANNOT Do

1. **No Session Modification** - Cannot patch, reset, delete, or compact sessions
2. **No Direct Messaging** - Cannot use `send` or `chat.send` for direct messages
3. **No Other Tenants** - Cannot enumerate or access other tenants
4. **No Backup Deletion** - Cannot delete backups
5. **No System Status** - Limited to health check only (no global logs/status)
6. **No Admin Config** - Cannot modify gateway, providers, or meta config
7. **No Wizard Access** - Configuration wizard is admin-only

## Implementation Reference

| Component            | File Path                                |
| -------------------- | ---------------------------------------- |
| Method authorization | `src/gateway/method-auth.ts`             |
| Tenant methods       | `src/gateway/server-methods/tenants.ts`  |
| Canvas blocking      | `src/gateway/server-http.ts:84-95`       |
| Session key scoping  | `src/gateway/http-utils.ts:86-111`       |
| Path resolution      | `src/tenants/paths.ts`                   |
| Token validation     | `src/tenants/registry.ts`                |
| Quota types          | `src/tenants/types.ts`                   |
| Terminal isolation   | `src/gateway/server-methods/terminal.ts` |
