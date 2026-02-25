import { describe, expect, it } from "vitest";
import type { GatewayClient, GatewayRequestOptions } from "./server-methods/types.js";
import { authorizeGatewayMethod } from "./method-auth.js";
import { ErrorCodes, type ErrorShape } from "./protocol/index.js";
import { tenantMethods } from "./server-methods/tenants.js";

type GatewayResponse = {
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
  meta?: Record<string, unknown>;
};

describe("tenant isolation authorization", () => {
  it("blocks non-tenant-safe methods for tenant tokens", () => {
    // Use wizard.start as an example of a blocked method (config.get is now allowed)
    const err = authorizeGatewayMethod("wizard.start", {
      connect: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
      tenantId: "tenant-a",
    } as GatewayClient);

    expect(err?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(err?.message).toContain("method not available for tenant token");
  });

  it("blocks global status method for tenant tokens", () => {
    const err = authorizeGatewayMethod("status", {
      connect: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
      tenantId: "tenant-a",
    } as GatewayClient);

    expect(err?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(err?.message).toContain("method not available for tenant token");
  });

  it("allows tenant-safe terminal methods for tenant tokens", () => {
    const err = authorizeGatewayMethod("terminal.list", {
      connect: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
      tenantId: "tenant-a",
    } as GatewayClient);

    expect(err).toBeNull();
  });

  it("keeps non-tenant admin access unchanged", () => {
    const err = authorizeGatewayMethod("config.get", {
      connect: {
        role: "operator",
        scopes: ["operator.admin"],
      },
    } as GatewayClient);

    expect(err).toBeNull();
  });
});

describe("tenant handler access checks", () => {
  it("denies cross-tenant access for tenant-scoped clients", async () => {
    let result: GatewayResponse | null = null;
    await tenantMethods["tenants.get"]({
      req: { type: "req", id: "1", method: "tenants.get", params: { tenantId: "tenant-b" } },
      params: { tenantId: "tenant-b" },
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        },
        tenantId: "tenant-a",
      } as GatewayRequestOptions["client"],
      isWebchatConnect: () => false,
      respond: (ok, payload, error, meta) => {
        result = { ok, payload, error, meta };
      },
      context: {} as GatewayRequestOptions["context"],
    });

    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toBe("Access denied");
  });
});
