import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { authorizeGatewayMethod } from "./method-auth.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { allResourceHandlers } from "./server-methods/admin-resources.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { tenantMethods } from "./server-methods/tenants.js";
import { terminalMethods } from "./server-methods/terminal.js";
import { ttsHandlers } from "./server-methods/tts.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  // OPENCLAWMU ADDITION: tenant resource APIs.
  ...allResourceHandlers,
  ...tenantMethods,
  // OPENCLAWMU ADDITION: web terminal RPC.
  ...terminalMethods,
  ...updateHandlers,
  ...nodeHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...browserHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  // OPENCLAWMU ADDITION: centralized per-method auth, including tenant allowlisting.
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  await handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    isWebchatConnect,
    respond,
    context,
  });
}
