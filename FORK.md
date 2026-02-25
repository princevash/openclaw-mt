# Openclawmu Additions Index

This file tracks fork-specific multi-tenant and terminal code so rebases onto `openclaw/openclaw`
are easier to audit.

Upstream repository: `https://github.com/openclaw/openclaw`

## Marker Convention

In upstream-touched files, fork logic is tagged with:

- `OPENCLAWMU ADDITION`

When resolving conflicts during rebase, search for this string first.

## Added Modules (Fork-Specific)

- `src/tenants/` (tenant registry, paths, quotas, backups, usage)
- `src/commands/tenants.ts` (tenant CLI surface)
- `src/gateway/method-auth.ts` (centralized method auth + tenant allowlist)
- `src/gateway/server-methods/tenants.ts` (tenant API methods)
- `src/gateway/server-methods/terminal.ts` (tenant PTY methods)
- `src/gateway/server-methods/admin-resources.ts` (tenant usage + admin resource methods)
- `src/gateway/internal-http.ts` (control-plane HTTP endpoints)
- `src/agents/sandbox/bwrap.ts`
- `src/agents/sandbox/bwrap-pty.ts`
- `src/agents/sandbox/backend.ts`
- `src/agents/sandbox/types.bwrap.ts`
- `ui/src/ui/terminal/` (xterm component)
- `ui/src/ui/controllers/terminal.ts`
- `ui/src/ui/views/terminal.ts`
- `ui/src/ui/views/admin-resources.ts`

## Upstream-Touched Files With Openclawmu Logic

Gateway/auth and routing:

- `src/gateway/auth.ts` (tenant token auth branch)
- `src/gateway/server/ws-connection/message-handler.ts` (tenant role/scope clamp at connect)
- `src/gateway/server/ws-types.ts` (tenantId on ws client)
- `src/gateway/server-methods/types.ts` (tenantId on gateway client)
- `src/gateway/server-methods.ts` (tenant/terminal handler registration + centralized auth)
- `src/gateway/server-methods-list.ts` (tenant/terminal methods and events advertised)
- `src/gateway/server-http.ts` (canvas auth excludes tenant tokens / tenant ws fallback)
- `src/gateway/http-utils.ts` (tenant session-key scoping helper)
- `src/gateway/openai-http.ts` (tenant-scoped session keys for HTTP chat completions)
- `src/gateway/openresponses-http.ts` (tenant-scoped session keys for HTTP responses)
- `src/gateway/tools-invoke-http.ts` (tenant-token block retained)

Session key handling:

- `src/sessions/session-key-utils.ts` (tenant-prefixed session key parsing)
- `src/routing/session-key.ts` (agent-id resolution from tenant-prefixed keys)

Control UI terminal wiring:

- `ui/src/ui/app.ts` (reactive terminal tab state)
- `ui/src/ui/app-view-state.ts` (terminal state contract)
- `ui/src/ui/app-render.ts` (terminal view wiring and tab actions)

## Regression Coverage For Fork Features

- `src/gateway/server-methods.tenant-isolation.test.ts`
- `src/gateway/server-methods-list.multi-tenancy.test.ts`
- `src/gateway/server-http.canvas-auth.test.ts`
- `src/gateway/http-utils.tenant.test.ts`
- `src/gateway/http-tenant-session-scope.test.ts`
- `src/gateway/tools-invoke-http.tenant-token.test.ts`
- `src/routing/session-key.test.ts`

## Rebase Checklist

1. Rebase from upstream `main`.
2. Search `OPENCLAWMU ADDITION` and resolve conflicts in those blocks first.
3. Verify fork regression tests still pass.
4. Verify UI build still passes for terminal tab.
