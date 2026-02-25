import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

/**
 * Result of successful gateway authorization.
 * OPENCLAWMU: Extended to include tenantId for multi-tenant session scoping.
 */
export type GatewayBearerAuthResult = {
  ok: true;
  tenantId?: string;
};

export async function authorizeGatewayBearerRequestOrReply(params: {
  req: IncomingMessage;
  res: ServerResponse;
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayBearerAuthResult | false> {
  const token = getBearerToken(params.req);
  const authResult = await authorizeGatewayConnect({
    auth: params.auth,
    connectAuth: token ? { token, password: token } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    rateLimiter: params.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(params.res, authResult);
    return false;
  }
  // OPENCLAWMU: Return auth result with tenantId for session scoping
  return { ok: true, tenantId: authResult.tenantId };
}
