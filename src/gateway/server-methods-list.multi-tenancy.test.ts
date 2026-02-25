import { describe, expect, it } from "vitest";
import { GATEWAY_EVENTS, listGatewayMethods } from "./server-methods-list.js";

describe("multi-tenant and terminal method registration", () => {
  it("keeps terminal and tenant methods advertised", () => {
    const methods = new Set(listGatewayMethods());

    expect(methods.has("terminal.spawn")).toBe(true);
    expect(methods.has("terminal.write")).toBe(true);
    expect(methods.has("terminal.resize")).toBe(true);
    expect(methods.has("terminal.close")).toBe(true);
    expect(methods.has("terminal.list")).toBe(true);

    expect(methods.has("tenants.get")).toBe(true);
    expect(methods.has("tenants.rotate")).toBe(true);
    expect(methods.has("tenants.backup")).toBe(true);
    expect(methods.has("tenants.backups.list")).toBe(true);
    expect(methods.has("tenants.usage")).toBe(true);
    expect(methods.has("tenants.quota.status")).toBe(true);
    expect(methods.has("tenants.usage.history")).toBe(true);
  });

  it("keeps terminal events advertised", () => {
    expect(GATEWAY_EVENTS).toContain("terminal.output");
    expect(GATEWAY_EVENTS).toContain("terminal.exit");
  });
});
