import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import {
  approveDevicePairing,
  listDevicePairing,
  type DeviceAuthToken,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
  summarizeDeviceTokens,
} from "../../infra/device-pairing.js";
import { resolveTenantStateDir } from "../../tenants/paths.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDevicePairApproveParams,
  validateDevicePairListParams,
  validateDevicePairRejectParams,
  validateDeviceTokenRevokeParams,
  validateDeviceTokenRotateParams,
} from "../protocol/index.js";

/**
 * Get the tenant ID from the request, if present.
 */
function getTenantId(opts: GatewayRequestHandlerOptions): string | undefined {
  return opts.client?.tenantId;
}

/**
 * Get the base directory for device pairing storage.
 * For tenants, this is the tenant's state directory.
 */
function getBaseDir(opts: GatewayRequestHandlerOptions): string | undefined {
  const tenantId = getTenantId(opts);
  return tenantId ? resolveTenantStateDir(tenantId) : undefined;
}

function redactPairedDevice(
  device: { tokens?: Record<string, DeviceAuthToken> } & Record<string, unknown>,
) {
  const { tokens, ...rest } = device;
  return {
    ...rest,
    tokens: summarizeDeviceTokens(tokens),
  };
}

export const deviceHandlers: GatewayRequestHandlers = {
  "device.pair.list": async (opts) => {
    const { params, respond } = opts;
    if (!validateDevicePairListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.list params: ${formatValidationErrors(
            validateDevicePairListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const baseDir = getBaseDir(opts);
    const list = await listDevicePairing(baseDir);
    respond(
      true,
      {
        pending: list.pending,
        paired: list.paired.map((device) => redactPairedDevice(device)),
      },
      undefined,
    );
  },
  "device.pair.approve": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateDevicePairApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.approve params: ${formatValidationErrors(
            validateDevicePairApproveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    const baseDir = getBaseDir(opts);
    const approved = await approveDevicePairing(requestId, baseDir);
    if (!approved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    context.logGateway.info(
      `device pairing approved device=${approved.device.deviceId} role=${approved.device.role ?? "unknown"}`,
    );
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: approved.device.deviceId,
        decision: "approved",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );
    respond(true, { requestId, device: redactPairedDevice(approved.device) }, undefined);
  },
  "device.pair.reject": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateDevicePairRejectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.reject params: ${formatValidationErrors(
            validateDevicePairRejectParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    const baseDir = getBaseDir(opts);
    const rejected = await rejectDevicePairing(requestId, baseDir);
    if (!rejected) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: rejected.deviceId,
        decision: "rejected",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );
    respond(true, rejected, undefined);
  },
  "device.token.rotate": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateDeviceTokenRotateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.rotate params: ${formatValidationErrors(
            validateDeviceTokenRotateParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role, scopes } = params as {
      deviceId: string;
      role: string;
      scopes?: string[];
    };
    const baseDir = getBaseDir(opts);
    const entry = await rotateDeviceToken({ deviceId, role, scopes, baseDir });
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId/role"));
      return;
    }
    context.logGateway.info(
      `device token rotated device=${deviceId} role=${entry.role} scopes=${entry.scopes.join(",")}`,
    );
    respond(
      true,
      {
        deviceId,
        role: entry.role,
        token: entry.token,
        scopes: entry.scopes,
        rotatedAtMs: entry.rotatedAtMs ?? entry.createdAtMs,
      },
      undefined,
    );
  },
  "device.token.revoke": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateDeviceTokenRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.revoke params: ${formatValidationErrors(
            validateDeviceTokenRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role } = params as { deviceId: string; role: string };
    const baseDir = getBaseDir(opts);
    const entry = await revokeDeviceToken({ deviceId, role, baseDir });
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId/role"));
      return;
    }
    context.logGateway.info(`device token revoked device=${deviceId} role=${entry.role}`);
    respond(
      true,
      { deviceId, role: entry.role, revokedAtMs: entry.revokedAtMs ?? Date.now() },
      undefined,
    );
  },
};
