/**
 * System-level resource metrics collection.
 *
 * Collects and stores system metrics for admin monitoring:
 * - CPU, memory, disk usage
 * - Process metrics
 * - Aggregate tenant statistics
 */

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStateDir } from "../config/paths.js";
import { resolveSystemMetricsDir } from "../tenants/paths.js";

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type SystemCpuMetrics = {
  /** Number of CPU cores. */
  cores: number;
  /** CPU usage percentage (0-100). */
  usagePercent: number;
  /** Load average [1min, 5min, 15min]. */
  loadAverage: [number, number, number];
};

export type SystemMemoryMetrics = {
  /** Total memory in bytes. */
  totalBytes: number;
  /** Used memory in bytes. */
  usedBytes: number;
  /** Free memory in bytes. */
  freeBytes: number;
  /** Memory usage percentage (0-100). */
  usagePercent: number;
};

export type SystemDiskMetrics = {
  /** Total disk space in bytes. */
  totalBytes: number;
  /** Used disk space in bytes. */
  usedBytes: number;
  /** Available disk space in bytes. */
  availableBytes: number;
  /** Disk usage percentage (0-100). */
  usagePercent: number;
  /** Mount point. */
  mountPoint: string;
};

export type ProcessMetrics = {
  /** Process ID. */
  pid: number;
  /** Resident set size (memory) in bytes. */
  rssBytes: number;
  /** Heap used in bytes. */
  heapUsedBytes: number;
  /** Heap total in bytes. */
  heapTotalBytes: number;
  /** CPU time in user mode (microseconds). */
  cpuUserUs: number;
  /** CPU time in system mode (microseconds). */
  cpuSystemUs: number;
  /** Process uptime in seconds. */
  uptimeSeconds: number;
};

export type TenantAggregateMetrics = {
  /** Total number of tenants. */
  totalCount: number;
  /** Tenants active in the last hour. */
  activeCount: number;
  /** Total disk usage across all tenants. */
  totalDiskUsageBytes: number;
  /** Total tokens used this month across all tenants. */
  totalTokensThisMonth: number;
  /** Total cost this month across all tenants (cents). */
  totalCostThisMonthCents: number;
};

export type SystemResourceSnapshot = {
  /** Timestamp when snapshot was taken (Unix ms). */
  timestamp: number;
  /** System CPU metrics. */
  cpu: SystemCpuMetrics;
  /** System memory metrics. */
  memory: SystemMemoryMetrics;
  /** System disk metrics. */
  disk: SystemDiskMetrics;
  /** System uptime in seconds. */
  uptimeSeconds: number;
  /** Gateway process metrics. */
  process: ProcessMetrics;
  /** Active gateway connections. */
  activeConnections: number;
  /** Active sandboxes. */
  activeSandboxes: number;
  /** Aggregate tenant metrics (optional, expensive to compute). */
  tenants?: TenantAggregateMetrics;
};

export type TenantResourceSummary = {
  /** Tenant ID. */
  tenantId: string;
  /** Display name. */
  displayName?: string;
  /** Tokens used this month. */
  tokensUsed: number;
  /** Token limit (if set). */
  tokenLimit?: number;
  /** Token usage percentage. */
  tokenUsagePercent: number;
  /** Cost in cents. */
  costCents: number;
  /** Cost limit in cents (if set). */
  costLimitCents?: number;
  /** Cost usage percentage. */
  costUsagePercent: number;
  /** Disk usage in bytes. */
  diskUsageBytes: number;
  /** Disk limit in bytes (if set). */
  diskLimitBytes?: number;
  /** Disk usage percentage. */
  diskUsagePercent: number;
  /** Currently active sessions. */
  activeSessions: number;
  /** Total sessions this month. */
  totalSessions: number;
  /** Whether tenant is over any quota. */
  isOverQuota: boolean;
  /** Whether tenant is blocked. */
  isBlocked: boolean;
  /** Last activity timestamp (Unix ms). */
  lastActiveAt?: number;
};

// ============================================================================
// Metrics Buffer (in-memory circular buffer)
// ============================================================================

const BUFFER_SIZE = 2880; // 24 hours at 30-second resolution
const metricsBuffer: SystemResourceSnapshot[] = [];
let lastCpuInfo: { idle: number; total: number } | null = null;

// ============================================================================
// CPU Metrics
// ============================================================================

/**
 * Gets CPU core count and calculates usage percentage.
 */
async function getCpuMetrics(): Promise<SystemCpuMetrics> {
  const cpus = os.cpus();
  const cores = cpus.length;
  const loadAverage = os.loadavg() as [number, number, number];

  // Calculate CPU usage percentage from difference in idle time
  let usagePercent = 0;

  const currentIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const currentTotal = cpus.reduce(
    (acc, cpu) =>
      acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
    0,
  );

  if (lastCpuInfo) {
    const idleDiff = currentIdle - lastCpuInfo.idle;
    const totalDiff = currentTotal - lastCpuInfo.total;
    if (totalDiff > 0) {
      usagePercent = ((totalDiff - idleDiff) / totalDiff) * 100;
    }
  }

  lastCpuInfo = { idle: currentIdle, total: currentTotal };

  return {
    cores,
    usagePercent: Math.round(usagePercent * 10) / 10,
    loadAverage,
  };
}

// ============================================================================
// Memory Metrics
// ============================================================================

/**
 * Gets system memory metrics.
 */
function getMemoryMetrics(): SystemMemoryMetrics {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = (usedBytes / totalBytes) * 100;

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: Math.round(usagePercent * 10) / 10,
  };
}

// ============================================================================
// Disk Metrics
// ============================================================================

/**
 * Gets disk metrics for the state directory filesystem.
 */
async function getDiskMetrics(env: NodeJS.ProcessEnv = process.env): Promise<SystemDiskMetrics> {
  const stateDir = resolveStateDir(env);

  try {
    // Use df to get disk usage for the state directory
    const { stdout } = await execAsync(`df -B1 "${stateDir}" 2>/dev/null | tail -1`);
    const parts = stdout.trim().split(/\s+/);

    if (parts.length >= 6) {
      const totalBytes = parseInt(parts[1], 10);
      const usedBytes = parseInt(parts[2], 10);
      const availableBytes = parseInt(parts[3], 10);
      const mountPoint = parts[5];

      return {
        totalBytes,
        usedBytes,
        availableBytes,
        usagePercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
        mountPoint,
      };
    }
  } catch {
    // Fallback if df fails
  }

  return {
    totalBytes: 0,
    usedBytes: 0,
    availableBytes: 0,
    usagePercent: 0,
    mountPoint: "/",
  };
}

// ============================================================================
// Process Metrics
// ============================================================================

/**
 * Gets current process metrics.
 */
function getProcessMetrics(): ProcessMetrics {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  return {
    pid: process.pid,
    rssBytes: memoryUsage.rss,
    heapUsedBytes: memoryUsage.heapUsed,
    heapTotalBytes: memoryUsage.heapTotal,
    cpuUserUs: cpuUsage.user,
    cpuSystemUs: cpuUsage.system,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

// ============================================================================
// System Snapshot Collection
// ============================================================================

/**
 * Collects a full system resource snapshot.
 */
export async function collectSystemMetrics(
  options: {
    includeTenantsAggregate?: boolean;
    activeConnections?: number;
    activeSandboxes?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SystemResourceSnapshot> {
  const [cpu, disk] = await Promise.all([getCpuMetrics(), getDiskMetrics(env)]);

  const snapshot: SystemResourceSnapshot = {
    timestamp: Date.now(),
    cpu,
    memory: getMemoryMetrics(),
    disk,
    uptimeSeconds: os.uptime(),
    process: getProcessMetrics(),
    activeConnections: options.activeConnections ?? 0,
    activeSandboxes: options.activeSandboxes ?? 0,
  };

  return snapshot;
}

/**
 * Adds a snapshot to the in-memory buffer.
 */
function addToBuffer(snapshot: SystemResourceSnapshot): void {
  metricsBuffer.push(snapshot);
  if (metricsBuffer.length > BUFFER_SIZE) {
    metricsBuffer.shift();
  }
}

/**
 * Gets the current metrics buffer.
 */
export function getMetricsBuffer(): SystemResourceSnapshot[] {
  return [...metricsBuffer];
}

/**
 * Gets recent metrics with optional time range filtering.
 */
export function getRecentMetrics(
  hours: number = 1,
  resolution: "30s" | "1m" | "5m" | "15m" | "1h" = "30s",
): SystemResourceSnapshot[] {
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;

  let filtered = metricsBuffer.filter((m) => m.timestamp >= cutoff);

  // Apply resolution downsampling
  const resolutionMs = {
    "30s": 30 * 1000,
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
  }[resolution];

  if (resolutionMs > 30 * 1000) {
    const downsampled: SystemResourceSnapshot[] = [];
    let lastBucket = 0;

    for (const metric of filtered) {
      const bucket = Math.floor(metric.timestamp / resolutionMs);
      if (bucket > lastBucket) {
        downsampled.push(metric);
        lastBucket = bucket;
      }
    }
    filtered = downsampled;
  }

  return filtered;
}

// ============================================================================
// Metrics Collection Loop
// ============================================================================

let collectionInterval: NodeJS.Timeout | null = null;

/**
 * Starts the metrics collection loop.
 */
export function startMetricsCollection(
  intervalMs: number = 30000,
  getConnectionCount?: () => number,
  getSandboxCount?: () => number,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (collectionInterval) {
    return; // Already running
  }

  // Collect immediately on start
  void collectAndStore(getConnectionCount, getSandboxCount, env);

  collectionInterval = setInterval(() => {
    void collectAndStore(getConnectionCount, getSandboxCount, env);
  }, intervalMs);
}

/**
 * Stops the metrics collection loop.
 */
export function stopMetricsCollection(): void {
  if (collectionInterval) {
    clearInterval(collectionInterval);
    collectionInterval = null;
  }
}

/**
 * Collects metrics and adds to buffer.
 */
async function collectAndStore(
  getConnectionCount?: () => number,
  getSandboxCount?: () => number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const snapshot = await collectSystemMetrics(
      {
        activeConnections: getConnectionCount?.() ?? 0,
        activeSandboxes: getSandboxCount?.() ?? 0,
      },
      env,
    );
    addToBuffer(snapshot);

    // Persist current snapshot to disk
    await saveCurrentSnapshot(snapshot, env);
  } catch (error) {
    // Don't let collection errors crash the gateway
    console.error("[system-metrics] Collection error:", error);
  }
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Saves the current snapshot to disk.
 */
async function saveCurrentSnapshot(
  snapshot: SystemResourceSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const metricsDir = resolveSystemMetricsDir(env);
  const currentPath = path.join(metricsDir, "system-current.json");

  try {
    await fs.mkdir(metricsDir, { recursive: true });
    await fs.writeFile(currentPath, JSON.stringify(snapshot, null, 2));
  } catch {
    // Ignore write errors
  }
}

/**
 * Loads the last saved snapshot from disk.
 */
export async function loadCurrentSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SystemResourceSnapshot | null> {
  const metricsDir = resolveSystemMetricsDir(env);
  const currentPath = path.join(metricsDir, "system-current.json");

  try {
    const content = await fs.readFile(currentPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Saves hourly aggregates (called at the end of each hour).
 */
export async function saveHourlyAggregate(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const metricsDir = resolveSystemMetricsDir(env);
  const hourlyDir = path.join(metricsDir, "system-hourly");
  await fs.mkdir(hourlyDir, { recursive: true });

  const now = new Date();
  const hourStr = now.toISOString().slice(0, 13).replace("T", "-");
  const hourPath = path.join(hourlyDir, `${hourStr}.json`);

  // Get metrics from the last hour
  const hourlyMetrics = getRecentMetrics(1, "5m");

  if (hourlyMetrics.length === 0) {
    return;
  }

  // Calculate aggregates
  const aggregate = {
    hour: hourStr,
    sampleCount: hourlyMetrics.length,
    cpu: {
      avgUsagePercent:
        hourlyMetrics.reduce((sum, m) => sum + m.cpu.usagePercent, 0) / hourlyMetrics.length,
      maxUsagePercent: Math.max(...hourlyMetrics.map((m) => m.cpu.usagePercent)),
      avgLoad1m:
        hourlyMetrics.reduce((sum, m) => sum + m.cpu.loadAverage[0], 0) / hourlyMetrics.length,
    },
    memory: {
      avgUsagePercent:
        hourlyMetrics.reduce((sum, m) => sum + m.memory.usagePercent, 0) / hourlyMetrics.length,
      maxUsageBytes: Math.max(...hourlyMetrics.map((m) => m.memory.usedBytes)),
    },
    disk: {
      avgUsagePercent:
        hourlyMetrics.reduce((sum, m) => sum + m.disk.usagePercent, 0) / hourlyMetrics.length,
      endUsageBytes: hourlyMetrics[hourlyMetrics.length - 1].disk.usedBytes,
    },
    process: {
      avgRssBytes:
        hourlyMetrics.reduce((sum, m) => sum + m.process.rssBytes, 0) / hourlyMetrics.length,
      maxRssBytes: Math.max(...hourlyMetrics.map((m) => m.process.rssBytes)),
    },
    connections: {
      maxActive: Math.max(...hourlyMetrics.map((m) => m.activeConnections)),
    },
    sandboxes: {
      maxActive: Math.max(...hourlyMetrics.map((m) => m.activeSandboxes)),
    },
  };

  await fs.writeFile(hourPath, JSON.stringify(aggregate, null, 2));
}

// ============================================================================
// Exports
// ============================================================================

// Types are already exported inline above (lines 74, 87, 108)
