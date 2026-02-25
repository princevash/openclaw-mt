import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";
import type { TenantContext } from "../server-methods/types.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  /** Tenant ID for multi-tenant authentication. */
  tenantId?: string;
  /** Full tenant context with resolved paths. */
  tenantContext?: TenantContext;
};
