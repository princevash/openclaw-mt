import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";
import { loadVoiceWakeConfig, setVoiceWakeTriggers } from "../../infra/voicewake.js";
import { resolveTenantStateDir } from "../../tenants/paths.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { normalizeVoiceWakeTriggers } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";

/**
 * Get the tenant ID from the request, if present.
 * OPENCLAWMU: Per-tenant voice wake support.
 */
function getTenantId(opts: GatewayRequestHandlerOptions): string | undefined {
  return opts.client?.tenantId;
}

/**
 * Resolve the base directory for voice wake config.
 * For tenants, use their state directory. For global, use undefined (default).
 */
function resolveVoiceWakeBaseDir(tenantId: string | undefined): string | undefined {
  return tenantId ? resolveTenantStateDir(tenantId) : undefined;
}

export const voicewakeHandlers: GatewayRequestHandlers = {
  "voicewake.get": async (opts) => {
    const { respond } = opts;
    const tenantId = getTenantId(opts);
    try {
      const baseDir = resolveVoiceWakeBaseDir(tenantId);
      const cfg = await loadVoiceWakeConfig(baseDir);
      respond(true, { triggers: cfg.triggers });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "voicewake.set": async (opts) => {
    const { params, respond, context } = opts;
    const tenantId = getTenantId(opts);
    if (!Array.isArray(params.triggers)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "voicewake.set requires triggers: string[]"),
      );
      return;
    }
    try {
      const baseDir = resolveVoiceWakeBaseDir(tenantId);
      const triggers = normalizeVoiceWakeTriggers(params.triggers);
      const cfg = await setVoiceWakeTriggers(triggers, baseDir);
      // Only broadcast for global changes (not tenant-specific)
      if (!tenantId) {
        context.broadcastVoiceWakeChanged(cfg.triggers);
      }
      respond(true, { triggers: cfg.triggers });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
