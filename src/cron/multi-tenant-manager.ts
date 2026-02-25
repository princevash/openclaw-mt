/**
 * Multi-tenant cron manager.
 * OPENCLAWMU ADDITION: manages per-tenant CronService instances alongside the global one.
 *
 * This enables automatic scheduling of tenant cron jobs by creating a CronService
 * instance for each active tenant with jobs.
 */

import type { CliDeps } from "../cli/deps.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfigForTenant } from "../config/config.js";
import { resolveAgentMainSessionKey } from "../config/sessions.js";
import { runHeartbeatOnce } from "../infra/heartbeat-runner.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getChildLogger } from "../logging.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { resolveTenantCronStorePath, resolveTenantSessionsDir } from "../tenants/paths.js";
import { listTenants, getTenant } from "../tenants/registry.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";
import { appendCronRunLog, resolveCronRunLogPath } from "./run-log.js";
import { CronService } from "./service.js";
import { loadCronStore } from "./store.js";

export type MultiTenantCronManager = {
  /** Get the global CronService */
  getGlobalService: () => CronService;
  /** Get a tenant's CronService if it exists */
  getTenantService: (tenantId: string) => CronService | undefined;
  /** Ensure a tenant has a CronService (creates if needed) */
  ensureTenantService: (tenantId: string) => Promise<CronService>;
  /** Remove a tenant's CronService (e.g., when tenant is deleted) */
  removeTenantService: (tenantId: string) => void;
  /** Start all services (global + active tenants) */
  startAll: () => Promise<void>;
  /** Stop all services */
  stopAll: () => void;
  /** Get the global cron store path */
  globalStorePath: string;
  /** Check if cron is enabled */
  cronEnabled: boolean;
};

export type MultiTenantCronManagerParams = {
  globalService: CronService;
  globalStorePath: string;
  cronEnabled: boolean;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
};

/**
 * Create a multi-tenant cron manager.
 */
export function createMultiTenantCronManager(
  params: MultiTenantCronManagerParams,
): MultiTenantCronManager {
  const { globalService, globalStorePath, cronEnabled, deps, broadcast } = params;
  const tenantServices = new Map<string, CronService>();
  const cronLogger = getChildLogger({ module: "cron" });

  /**
   * Resolve the agent for a cron job in tenant context.
   */
  function resolveTenantCronAgent(tenantId: string, requested?: string | null) {
    const runtimeConfig = loadConfigForTenant(tenantId);
    const normalized =
      typeof requested === "string" && requested.trim() ? normalizeAgentId(requested) : undefined;
    const hasAgent =
      normalized !== undefined &&
      Array.isArray(runtimeConfig.agents?.list) &&
      runtimeConfig.agents.list.some(
        (entry) =>
          entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalized,
      );
    const agentId = hasAgent ? normalized : resolveDefaultAgentId(runtimeConfig);
    return { agentId, cfg: runtimeConfig };
  }

  /**
   * Create a CronService for a tenant.
   */
  function createTenantCronService(tenantId: string): CronService {
    const storePath = resolveTenantCronStorePath(tenantId);
    const tenantConfig = loadConfigForTenant(tenantId);
    const defaultAgentId = resolveDefaultAgentId(tenantConfig);

    const resolveSessionStorePath = (agentId?: string) =>
      resolveTenantSessionsDir(tenantId, agentId ?? defaultAgentId);

    const service = new CronService({
      storePath,
      cronEnabled,
      cronConfig: tenantConfig.cron,
      defaultAgentId,
      resolveSessionStorePath,
      sessionStorePath: resolveSessionStorePath(defaultAgentId),
      tenantId, // Pass tenant context
      enqueueSystemEvent: (text, opts) => {
        const { agentId, cfg: runtimeConfig } = resolveTenantCronAgent(tenantId, opts?.agentId);
        const sessionKey = `tenant:${tenantId}:${resolveAgentMainSessionKey({
          cfg: runtimeConfig,
          agentId,
        })}`;
        enqueueSystemEvent(text, { sessionKey, contextKey: opts?.contextKey });
      },
      requestHeartbeatNow: (opts) => {
        // Request heartbeat with tenant context
        requestHeartbeatNow({ ...opts, reason: `tenant:${tenantId}:${opts?.reason ?? "cron"}` });
      },
      runHeartbeatOnce: async (opts) => {
        const runtimeConfig = loadConfigForTenant(tenantId);
        const agentId = opts?.agentId
          ? resolveTenantCronAgent(tenantId, opts.agentId).agentId
          : undefined;
        return await runHeartbeatOnce({
          cfg: runtimeConfig,
          reason: opts?.reason,
          agentId,
          deps: { ...deps, runtime: defaultRuntime },
        });
      },
      runIsolatedAgentJob: async ({ job, message }) => {
        const { agentId, cfg: runtimeConfig } = resolveTenantCronAgent(tenantId, job.agentId);
        return await runCronIsolatedAgentTurn({
          cfg: runtimeConfig,
          deps,
          job,
          message,
          agentId,
          sessionKey: `tenant:${tenantId}:cron:${job.id}`,
          lane: "cron",
        });
      },
      log: getChildLogger({ module: "cron", tenantId, storePath }),
      onEvent: (evt) => {
        // Broadcast with tenant prefix
        broadcast(`tenant:${tenantId}:cron`, evt, { dropIfSlow: true });
        if (evt.action === "finished") {
          const logPath = resolveCronRunLogPath({ storePath, jobId: evt.jobId });
          void appendCronRunLog(logPath, {
            ts: Date.now(),
            jobId: evt.jobId,
            action: "finished",
            status: evt.status,
            error: evt.error,
            summary: evt.summary,
            sessionId: evt.sessionId,
            sessionKey: evt.sessionKey,
            runAtMs: evt.runAtMs,
            durationMs: evt.durationMs,
            nextRunAtMs: evt.nextRunAtMs,
          }).catch((err) => {
            cronLogger.warn(
              { err: String(err), logPath, tenantId },
              "cron: tenant run log append failed",
            );
          });
        }
      },
    });

    return service;
  }

  /**
   * Check if a tenant has cron jobs.
   */
  async function tenantHasCronJobs(tenantId: string): Promise<boolean> {
    try {
      const storePath = resolveTenantCronStorePath(tenantId);
      const store = await loadCronStore(storePath);
      return store.jobs.length > 0;
    } catch {
      return false;
    }
  }

  return {
    getGlobalService: () => globalService,

    getTenantService: (tenantId) => tenantServices.get(tenantId),

    ensureTenantService: async (tenantId) => {
      let service = tenantServices.get(tenantId);
      if (!service) {
        service = createTenantCronService(tenantId);
        tenantServices.set(tenantId, service);
        if (cronEnabled) {
          await service.start();
        }
      }
      return service;
    },

    removeTenantService: (tenantId) => {
      const service = tenantServices.get(tenantId);
      if (service) {
        service.stop();
        tenantServices.delete(tenantId);
      }
    },

    startAll: async () => {
      // Start global service
      if (cronEnabled) {
        await globalService.start();
      }

      // Start services for tenants that have cron jobs
      try {
        const tenantIds = listTenants();
        for (const tenantId of tenantIds) {
          const tenant = getTenant(tenantId);
          if (!tenant || tenant.disabled) {
            continue;
          }
          const hasJobs = await tenantHasCronJobs(tenantId);
          if (hasJobs) {
            cronLogger.info({ tenantId }, "cron: starting tenant scheduler");
            const service = createTenantCronService(tenantId);
            tenantServices.set(tenantId, service);
            if (cronEnabled) {
              await service.start();
            }
          }
        }
      } catch (err) {
        cronLogger.warn({ err: String(err) }, "cron: failed to scan tenants for cron jobs");
      }
    },

    stopAll: () => {
      globalService.stop();
      for (const [tenantId, service] of tenantServices) {
        service.stop();
        cronLogger.debug({ tenantId }, "cron: stopped tenant scheduler");
      }
      tenantServices.clear();
    },

    globalStorePath,
    cronEnabled,
  };
}
