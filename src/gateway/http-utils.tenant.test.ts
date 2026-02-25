import { describe, expect, it } from "vitest";
import { scopeSessionKeyToTenant } from "./http-utils.js";

describe("scopeSessionKeyToTenant", () => {
  it("adds tenant prefix when session key is not tenant-scoped", () => {
    const result = scopeSessionKeyToTenant({
      sessionKey: "agent:beta:openai:123",
      tenantId: "tenant-a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sessionKey).toBe("tenant:tenant-a:agent:beta:openai:123");
  });

  it("keeps matching tenant-prefixed session keys", () => {
    const result = scopeSessionKeyToTenant({
      sessionKey: "tenant:tenant-a:agent:beta:openai:123",
      tenantId: "tenant-a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sessionKey).toBe("tenant:tenant-a:agent:beta:openai:123");
  });

  it("rejects mismatched tenant-prefixed session keys", () => {
    const result = scopeSessionKeyToTenant({
      sessionKey: "tenant:tenant-b:agent:beta:openai:123",
      tenantId: "tenant-a",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("does not match authenticated tenant");
  });

  it("does not change session keys for non-tenant auth", () => {
    const result = scopeSessionKeyToTenant({
      sessionKey: "agent:beta:openai:123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sessionKey).toBe("agent:beta:openai:123");
  });
});
