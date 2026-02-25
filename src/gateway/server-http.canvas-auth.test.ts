import { describe, expect, it } from "vitest";
import type { GatewayWsClient } from "./server/ws-types.js";
import { hasAuthorizedWsClientForIp } from "./server-http.js";

function makeClient(params: {
  connId: string;
  clientIp: string;
  tenantId?: string;
}): GatewayWsClient {
  return {
    socket: {} as GatewayWsClient["socket"],
    connect: {} as GatewayWsClient["connect"],
    connId: params.connId,
    clientIp: params.clientIp,
    tenantId: params.tenantId,
  };
}

describe("hasAuthorizedWsClientForIp", () => {
  it("allows tenant-scoped websocket clients for canvas access", () => {
    const clients = new Set<GatewayWsClient>([
      makeClient({ connId: "tenant-1", clientIp: "203.0.113.10", tenantId: "tenant-a" }),
    ]);

    // Tenants are now allowed canvas access (resource isolation is a separate concern)
    expect(hasAuthorizedWsClientForIp(clients, "203.0.113.10")).toBe(true);
  });

  it("accepts non-tenant websocket clients for canvas IP fallback", () => {
    const clients = new Set<GatewayWsClient>([
      makeClient({ connId: "tenant-1", clientIp: "203.0.113.10", tenantId: "tenant-a" }),
      makeClient({ connId: "admin-1", clientIp: "203.0.113.10" }),
    ]);

    expect(hasAuthorizedWsClientForIp(clients, "203.0.113.10")).toBe(true);
  });
});
