import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentCommand } from "../commands/agent.js";
import { authorizeGatewayConnect } from "./auth.js";
import { readJsonBodyOrError } from "./http-common.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";

vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return {
    ...actual,
    authorizeGatewayConnect: vi.fn(),
  };
});

vi.mock("./http-common.js", async () => {
  const actual = await vi.importActual<typeof import("./http-common.js")>("./http-common.js");
  return {
    ...actual,
    readJsonBodyOrError: vi.fn(),
  };
});

vi.mock("../commands/agent.js", async () => {
  const actual =
    await vi.importActual<typeof import("../commands/agent.js")>("../commands/agent.js");
  return {
    ...actual,
    agentCommand: vi.fn(),
  };
});

function createRequest(params: { pathname: string; sessionKey: string }): IncomingMessage {
  return {
    url: params.pathname,
    method: "POST",
    headers: {
      host: "localhost",
      authorization: "Bearer tenant:test:token",
      "content-type": "application/json",
      "x-openclaw-agent-id": "beta",
      "x-openclaw-session-key": params.sessionKey,
    },
  } as unknown as IncomingMessage;
}

function createResponse(): {
  res: ServerResponse;
  read: () => Record<string, unknown>;
} {
  let body = "";
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: unknown) => {
      if (typeof chunk === "string") {
        body = chunk;
      }
    }),
    write: vi.fn(),
    flushHeaders: vi.fn(),
  } as unknown as ServerResponse;
  return {
    res,
    read: () => (body ? (JSON.parse(body) as Record<string, unknown>) : {}),
  };
}

describe("HTTP tenant session scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeGatewayConnect).mockResolvedValue({
      ok: true,
      method: "tenant-token",
      tenantId: "tenant-a",
    });
    vi.mocked(agentCommand).mockResolvedValue({ payloads: [{ text: "ok" }] } as never);
  });

  it("scopes OpenAI chat completions session keys to authenticated tenant", async () => {
    vi.mocked(readJsonBodyOrError).mockResolvedValue({
      model: "openclaw:beta",
      messages: [{ role: "user", content: "hello" }],
    });
    const req = createRequest({
      pathname: "/v1/chat/completions",
      sessionKey: "agent:beta:openai:custom",
    });
    const { res } = createResponse();

    const handled = await handleOpenAiHttpRequest(req, res, {
      auth: { mode: "token", token: "secret", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const [opts] = vi.mocked(agentCommand).mock.calls[0] ?? [];
    expect((opts as { sessionKey?: string } | undefined)?.sessionKey).toBe(
      "tenant:tenant-a:agent:beta:openai:custom",
    );
  });

  it("rejects mismatched tenant key for OpenAI chat completions", async () => {
    vi.mocked(readJsonBodyOrError).mockResolvedValue({
      model: "openclaw:beta",
      messages: [{ role: "user", content: "hello" }],
    });
    const req = createRequest({
      pathname: "/v1/chat/completions",
      sessionKey: "tenant:other:agent:beta:openai:custom",
    });
    const { res, read } = createResponse();

    const handled = await handleOpenAiHttpRequest(req, res, {
      auth: { mode: "token", token: "secret", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect((read().error as { type?: string } | undefined)?.type).toBe("forbidden");
    expect(vi.mocked(agentCommand)).not.toHaveBeenCalled();
  });

  it("scopes OpenResponses session keys to authenticated tenant", async () => {
    vi.mocked(readJsonBodyOrError).mockResolvedValue({
      model: "openclaw:beta",
      input: "hello",
    });
    const req = createRequest({
      pathname: "/v1/responses",
      sessionKey: "agent:beta:openresponses:custom",
    });
    const { res } = createResponse();

    const handled = await handleOpenResponsesHttpRequest(req, res, {
      auth: { mode: "token", token: "secret", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const [opts] = vi.mocked(agentCommand).mock.calls[0] ?? [];
    expect((opts as { sessionKey?: string } | undefined)?.sessionKey).toBe(
      "tenant:tenant-a:agent:beta:openresponses:custom",
    );
  });
});
