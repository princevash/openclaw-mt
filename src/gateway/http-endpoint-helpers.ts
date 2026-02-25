import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { authorizeGatewayBearerRequestOrReply } from "./http-auth-helpers.js";
import { readJsonBodyOrError, sendMethodNotAllowed } from "./http-common.js";

/**
 * Result of a successful POST JSON endpoint request.
 * OPENCLAWMU: Extended to include tenantId for multi-tenant session scoping.
 */
export type PostJsonEndpointResult = {
  body: unknown;
  tenantId?: string;
};

export async function handleGatewayPostJsonEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    auth: ResolvedGatewayAuth;
    maxBodyBytes: number;
    trustedProxies?: string[];
    rateLimiter?: AuthRateLimiter;
  },
): Promise<false | PostJsonEndpointResult | undefined> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== opts.pathname) {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return undefined;
  }

  const authResult = await authorizeGatewayBearerRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult) {
    return undefined;
  }

  const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes);
  if (body === undefined) {
    return undefined;
  }

  // OPENCLAWMU: Include tenantId in result for session scoping
  return { body, tenantId: authResult.tenantId };
}
