import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeGatewayConnect } from "./auth.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return {
    ...actual,
    authorizeGatewayConnect: vi.fn(),
  };
});

function createRequest(): IncomingMessage {
  return {
    url: "/tools/invoke",
    method: "POST",
    headers: {
      host: "localhost",
      authorization: "Bearer tenant:test:token",
      "content-type": "application/json",
    },
  } as unknown as IncomingMessage;
}

function createResponse(): {
  res: ServerResponse;
  getJson: () => Record<string, unknown>;
} {
  let payload = "";
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: unknown) => {
      if (typeof chunk === "string") {
        payload = chunk;
      }
    }),
  } as unknown as ServerResponse;
  return {
    res,
    getJson: () => JSON.parse(payload) as Record<string, unknown>,
  };
}

describe("tools invoke tenant token guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeGatewayConnect).mockResolvedValue({
      ok: true,
      method: "tenant-token",
      tenantId: "tenant-test",
    });
  });

  it("rejects tenant-token auth", async () => {
    const req = createRequest();
    const { res, getJson } = createResponse();

    const handled = await handleToolsInvokeHttpRequest(req, res, {
      auth: { mode: "token", token: "secret", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(getJson().error).toMatchObject({ type: "forbidden" });
  });
});
