import { randomUUID } from "node:crypto";
import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile } from "../../cron/types.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { readCronRunLogEntries, resolveCronRunLogPath } from "../../cron/run-log.js";
import { loadCronStore, saveCronStore } from "../../cron/store.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import { resolveTenantCronStorePath } from "../../tenants/paths.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";

/**
 * Get the tenant ID from the request, if present.
 */
function getTenantId(opts: GatewayRequestHandlerOptions): string | undefined {
  return opts.client?.tenantId;
}

/**
 * Tenant-specific cron helpers.
 * Tenants have their own cron job storage but no automatic scheduling.
 * Jobs can be manually triggered via cron.run.
 */
async function loadTenantCronJobs(tenantId: string): Promise<CronStoreFile> {
  const storePath = resolveTenantCronStorePath(tenantId);
  return await loadCronStore(storePath);
}

async function saveTenantCronJobs(tenantId: string, store: CronStoreFile): Promise<void> {
  const storePath = resolveTenantCronStorePath(tenantId);
  await saveCronStore(storePath, store);
}

function createCronJob(create: CronJobCreate): CronJob {
  const now = Date.now();
  return {
    ...create,
    id: randomUUID(),
    createdAtMs: now,
    updatedAtMs: now,
    state: create.state ?? {},
  };
}

function patchCronJob(job: CronJob, patch: CronJobPatch): CronJob {
  const updated: CronJob = { ...job, updatedAtMs: Date.now() };
  if (patch.name !== undefined) {
    updated.name = patch.name;
  }
  if (patch.description !== undefined) {
    updated.description = patch.description;
  }
  if (patch.enabled !== undefined) {
    updated.enabled = patch.enabled;
  }
  if (patch.deleteAfterRun !== undefined) {
    updated.deleteAfterRun = patch.deleteAfterRun;
  }
  if (patch.schedule !== undefined) {
    updated.schedule = patch.schedule;
  }
  if (patch.sessionTarget !== undefined) {
    updated.sessionTarget = patch.sessionTarget;
  }
  if (patch.wakeMode !== undefined) {
    updated.wakeMode = patch.wakeMode;
  }
  if (patch.agentId !== undefined) {
    updated.agentId = patch.agentId;
  }
  if (patch.payload !== undefined) {
    updated.payload = { ...job.payload, ...patch.payload } as CronJob["payload"];
  }
  if (patch.delivery !== undefined) {
    updated.delivery = { ...job.delivery, ...patch.delivery };
  }
  if (patch.state !== undefined) {
    updated.state = { ...job.state, ...patch.state };
  }
  return updated;
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: (opts) => {
    const { params, respond, context } = opts;
    // Wake is not available for tenants (requires global heartbeat access)
    const tenantId = getTenantId(opts);
    if (tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "wake not available for tenant tokens"),
      );
      return;
    }
    if (!validateWakeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const result = context.cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateCronListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { includeDisabled?: boolean };
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // Tenant-specific: load from tenant cron store
      const store = await loadTenantCronJobs(tenantId);
      const jobs = p.includeDisabled ? store.jobs : store.jobs.filter((job) => job.enabled);
      respond(true, { jobs }, undefined);
      return;
    }
    const jobs = await context.cron.list({
      includeDisabled: p.includeDisabled,
    });
    respond(true, { jobs }, undefined);
  },
  "cron.status": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateCronStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // OPENCLAWMU: Use tenant's CronService for status if available
      if (context.cronManager) {
        const tenantService = context.cronManager.getTenantService(tenantId);
        if (tenantService) {
          const status = await tenantService.status();
          respond(true, status, undefined);
          return;
        }
      }
      // Fallback: load from store if no service started yet
      const store = await loadTenantCronJobs(tenantId);
      respond(
        true,
        {
          enabled: context.cronManager?.cronEnabled ?? false,
          schedulerRunning: false,
          jobCount: store.jobs.length,
          enabledJobCount: store.jobs.filter((j) => j.enabled).length,
          note: "Tenant cron scheduler will start when jobs are added",
        },
        undefined,
      );
      return;
    }
    const status = await context.cron.status();
    respond(true, status, undefined);
  },
  "cron.add": async (opts) => {
    const { params, respond, context } = opts;
    const normalized = normalizeCronJobCreate(params) ?? params;
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // Tenant-specific: add to tenant cron store
      const store = await loadTenantCronJobs(tenantId);
      const job = createCronJob(jobCreate);
      store.jobs.push(job);
      await saveTenantCronJobs(tenantId, store);
      respond(true, job, undefined);
      return;
    }
    const job = await context.cron.add(jobCreate);
    respond(true, job, undefined);
  },
  "cron.update": async (opts) => {
    const { params, respond, context } = opts;
    const normalizedPatch = normalizeCronJobPatch((params as { patch?: unknown } | null)?.patch);
    const candidate =
      normalizedPatch && typeof params === "object" && params !== null
        ? { ...params, patch: normalizedPatch }
        : params;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }
    const patch = p.patch as unknown as CronJobPatch;
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // Tenant-specific: update in tenant cron store
      const store = await loadTenantCronJobs(tenantId);
      const jobIndex = store.jobs.findIndex((j) => j.id === jobId);
      if (jobIndex < 0) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `job not found: ${jobId}`),
        );
        return;
      }
      const updated = patchCronJob(store.jobs[jobIndex], patch);
      store.jobs[jobIndex] = updated;
      await saveTenantCronJobs(tenantId, store);
      respond(true, updated, undefined);
      return;
    }
    const job = await context.cron.update(jobId, patch);
    respond(true, job, undefined);
  },
  "cron.remove": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateCronRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // Tenant-specific: remove from tenant cron store
      const store = await loadTenantCronJobs(tenantId);
      const jobIndex = store.jobs.findIndex((j) => j.id === jobId);
      if (jobIndex < 0) {
        respond(true, { removed: false, jobId }, undefined);
        return;
      }
      store.jobs.splice(jobIndex, 1);
      await saveTenantCronJobs(tenantId, store);
      respond(true, { removed: true, jobId }, undefined);
      return;
    }
    const result = await context.cron.remove(jobId);
    respond(true, result, undefined);
  },
  "cron.run": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateCronRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; mode?: "due" | "force" };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }
    const tenantId = getTenantId(opts);
    if (tenantId) {
      // OPENCLAWMU: Use tenant's CronService for execution
      if (!context.cronManager) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "cron manager not available"));
        return;
      }
      try {
        const tenantService = await context.cronManager.ensureTenantService(tenantId);
        const result = await tenantService.run(jobId, p.mode ?? "force");
        respond(true, result, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, `cron.run failed: ${String(err)}`),
        );
      }
      return;
    }
    const result = await context.cron.run(jobId, p.mode ?? "force");
    respond(true, result, undefined);
  },
  "cron.runs": async (opts) => {
    const { params, respond, context } = opts;
    if (!validateCronRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; limit?: number };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }
    const tenantId = getTenantId(opts);
    const storePath = tenantId ? resolveTenantCronStorePath(tenantId) : context.cronStorePath;
    const logPath = resolveCronRunLogPath({
      storePath,
      jobId,
    });
    const entries = await readCronRunLogEntries(logPath, {
      limit: p.limit,
      jobId,
    });
    respond(true, { entries }, undefined);
  },
};
