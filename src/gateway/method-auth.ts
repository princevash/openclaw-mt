import type { GatewayClient } from "./server-methods/types.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";

// OPENCLAWMU ADDITION: centralized gateway method authorization for multi-tenancy.
const ADMIN_SCOPE = "operator.admin";
const READ_SCOPE = "operator.read";
const WRITE_SCOPE = "operator.write";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";
const TENANT_ALLOWED_METHODS = new Set([
  "health",
  "terminal.spawn",
  "terminal.write",
  "terminal.resize",
  "terminal.close",
  "terminal.list",
  "tenants.get",
  "tenants.rotate",
  "tenants.backup",
  "tenants.backups.list",
  "tenants.restore",
  "tenants.delete",
  "tenants.usage",
  "tenants.quota.status",
  "tenants.usage.history",
  // Config management (tenant overlay)
  "config.get",
  "config.set",
  "config.patch",
  "config.schema",
  // Agent management (full CRUD for tenants)
  "agents.list",
  "agents.create",
  "agents.update",
  "agents.delete",
  "agents.files.list",
  "agents.files.get",
  "agents.files.set",
  // Session management
  "sessions.list",
  "sessions.preview",
  // Cron management (tenant-isolated, with auto-scheduling)
  "cron.list",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.status",
  "cron.runs",
  "cron.run",
  // Skills management (tenant-isolated)
  "skills.status",
  "skills.bins",
  "skills.install",
  "skills.update",
  // Channels (tenant-isolated operations)
  "channels.status",
  "channels.start",
  "channels.stop",
  "channels.logout",
  // Voice wake (per-tenant)
  "voicewake.get",
  "voicewake.set",
  // Device pairing (tenant-isolated)
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  // Node pairing (tenant-isolated)
  "node.pair.request",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "node.rename",
  "node.list",
  "node.describe",
  "node.invoke",
]);

const APPROVAL_METHODS = new Set(["exec.approval.request", "exec.approval.resolve"]);
const NODE_ROLE_METHODS = new Set(["node.invoke.result", "node.event", "skills.bins"]);
const PAIRING_METHODS = new Set([
  "node.pair.request",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  "node.rename",
]);
const ADMIN_METHOD_PREFIXES = ["exec.approvals."];
const READ_METHODS = new Set([
  "health",
  "logs.tail",
  "channels.status",
  "status",
  "usage.status",
  "usage.cost",
  "tts.status",
  "tts.providers",
  "models.list",
  "agents.list",
  "agent.identity.get",
  "skills.status",
  "voicewake.get",
  "sessions.list",
  "sessions.preview",
  "cron.list",
  "cron.status",
  "cron.runs",
  "system-presence",
  "last-heartbeat",
  "node.list",
  "node.describe",
  "chat.history",
  "terminal.list",
  "tenants.get",
  "tenants.backups.list",
  "tenants.usage",
  "tenants.quota.status",
  "tenants.usage.history",
]);
const WRITE_METHODS = new Set([
  "send",
  "agent",
  "agent.wait",
  "wake",
  "talk.mode",
  "tts.enable",
  "tts.disable",
  "tts.convert",
  "tts.setProvider",
  "voicewake.set",
  "node.invoke",
  "chat.send",
  "chat.abort",
  "browser.request",
  "terminal.spawn",
  "terminal.write",
  "terminal.resize",
  "terminal.close",
  "tenants.rotate",
  "tenants.backup",
]);

export function authorizeGatewayMethod(method: string, client: GatewayClient | null) {
  if (!client?.connect) {
    return null;
  }
  const role = client.connect.role ?? "operator";
  const scopes = client.connect.scopes ?? [];
  if (NODE_ROLE_METHODS.has(method)) {
    if (role === "node") {
      return null;
    }
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role !== "operator") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (client.tenantId && !TENANT_ALLOWED_METHODS.has(method)) {
    return errorShape(
      ErrorCodes.INVALID_REQUEST,
      `method not available for tenant token: ${method}`,
    );
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  if (APPROVAL_METHODS.has(method) && !scopes.includes(APPROVALS_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals");
  }
  if (PAIRING_METHODS.has(method) && !scopes.includes(PAIRING_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.pairing");
  }
  if (READ_METHODS.has(method) && !(scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.read");
  }
  if (WRITE_METHODS.has(method) && !scopes.includes(WRITE_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.write");
  }
  if (APPROVAL_METHODS.has(method)) {
    return null;
  }
  if (PAIRING_METHODS.has(method)) {
    return null;
  }
  if (READ_METHODS.has(method)) {
    return null;
  }
  if (WRITE_METHODS.has(method)) {
    return null;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  // Allow tenant tokens to use whitelisted methods even if they would normally require admin scope
  if (client.tenantId && TENANT_ALLOWED_METHODS.has(method)) {
    return null;
  }
  if (
    method.startsWith("config.") ||
    method.startsWith("wizard.") ||
    method.startsWith("update.") ||
    method === "channels.logout" ||
    method === "agents.create" ||
    method === "agents.update" ||
    method === "agents.delete" ||
    method === "skills.install" ||
    method === "skills.update" ||
    method === "cron.add" ||
    method === "cron.update" ||
    method === "cron.remove" ||
    method === "cron.run" ||
    method === "sessions.patch" ||
    method === "sessions.reset" ||
    method === "sessions.delete" ||
    method === "sessions.compact"
  ) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
}
