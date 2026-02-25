/**
 * Admin Resources Dashboard View
 *
 * System-level resource monitoring for administrators:
 * - System CPU, memory, disk metrics
 * - Per-tenant usage breakdown
 * - Active sandboxes monitoring
 * - Historical trend data
 */

import { html, css, type TemplateResult, nothing } from "lit";
import { renderIcon } from "../icons.js";

// ============================================================================
// Types
// ============================================================================

export type SystemMetrics = {
  timestamp: number;
  cpu: {
    cores: number;
    usagePercent: number;
    loadAverage: [number, number, number];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    mountPoint: string;
  };
  uptimeSeconds: number;
  process: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    uptimeSeconds: number;
  };
  activeConnections: number;
  activeSandboxes: number;
};

export type TenantSummary = {
  tenantId: string;
  displayName?: string;
  tokensUsed: number;
  tokenLimit?: number;
  tokenUsagePercent: number;
  costCents: number;
  costLimitCents?: number;
  costUsagePercent: number;
  diskUsageBytes: number;
  diskLimitBytes?: number;
  diskUsagePercent: number;
  activeSessions: number;
  totalSessions: number;
  isOverQuota: boolean;
  isBlocked: boolean;
  lastActiveAt?: number;
};

export type AdminResourcesViewState = {
  loading: boolean;
  error: string | null;
  systemMetrics: SystemMetrics | null;
  tenantSummaries: TenantSummary[];
  tenantAggregates: {
    totalCount: number;
    overQuotaCount: number;
    blockedCount: number;
    totalDiskUsageBytes: number;
    totalTokensUsed: number;
    totalCostCents: number;
  } | null;
  activeSandboxes: Array<{
    sandboxId: string;
    tenantId?: string;
    agentId?: string;
    pid?: number;
    createdAt: number;
  }>;
  sortBy: "tokensUsed" | "costCents" | "diskUsageBytes" | "activeSessions" | "lastActiveAt";
  lastRefresh: number | null;
};

// ============================================================================
// Styles
// ============================================================================

export const adminResourcesStyles = css`
  .admin-resources {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    padding: 16px;
    gap: 16px;
    background: var(--bg-primary, #1e1e1e);
  }

  .resources-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color, #3d3d3d);
  }

  .resources-header h2 {
    margin: 0;
    font-size: 18px;
    color: var(--text-primary, #fff);
  }

  .resources-header .actions {
    display: flex;
    gap: 8px;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary, #2d2d2d);
    border: 1px solid var(--border-color, #3d3d3d);
    border-radius: 4px;
    color: var(--text-secondary, #ccc);
    font-size: 13px;
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: var(--bg-hover, #3d3d3d);
    color: var(--text-primary, #fff);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .metric-card {
    background: var(--bg-secondary, #252526);
    border: 1px solid var(--border-color, #3d3d3d);
    border-radius: 8px;
    padding: 16px;
  }

  .metric-card .label {
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin-bottom: 4px;
  }

  .metric-card .value {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary, #fff);
  }

  .metric-card .sub-value {
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin-top: 4px;
  }

  .metric-card .progress-bar {
    margin-top: 8px;
    height: 4px;
    background: var(--bg-tertiary, #3d3d3d);
    border-radius: 2px;
    overflow: hidden;
  }

  .metric-card .progress-bar .fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .metric-card .progress-bar .fill.low {
    background: var(--status-connected, #4caf50);
  }

  .metric-card .progress-bar .fill.medium {
    background: var(--status-connecting, #ff9800);
  }

  .metric-card .progress-bar .fill.high {
    background: var(--status-error, #f44336);
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    margin: 16px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-color, #3d3d3d);
  }

  .tenants-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .tenants-table th {
    text-align: left;
    padding: 8px;
    border-bottom: 1px solid var(--border-color, #3d3d3d);
    color: var(--text-secondary, #888);
    font-weight: 500;
    cursor: pointer;
  }

  .tenants-table th:hover {
    color: var(--text-primary, #fff);
  }

  .tenants-table th.sorted {
    color: var(--accent-color, #007acc);
  }

  .tenants-table td {
    padding: 8px;
    border-bottom: 1px solid var(--border-subtle, #2d2d2d);
    color: var(--text-primary, #ccc);
  }

  .tenants-table tr:hover td {
    background: var(--bg-hover, #2a2d2e);
  }

  .tenants-table .status-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
  }

  .tenants-table .status-badge.ok {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .tenants-table .status-badge.warning {
    background: rgba(255, 152, 0, 0.2);
    color: #ff9800;
  }

  .tenants-table .status-badge.blocked {
    background: rgba(244, 67, 54, 0.2);
    color: #f44336;
  }

  .sandboxes-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sandbox-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: var(--bg-secondary, #252526);
    border: 1px solid var(--border-color, #3d3d3d);
    border-radius: 6px;
  }

  .sandbox-item .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sandbox-item .sandbox-id {
    font-family: monospace;
    font-size: 13px;
    color: var(--text-primary, #fff);
  }

  .sandbox-item .sandbox-meta {
    font-size: 11px;
    color: var(--text-secondary, #888);
  }

  .sandbox-item .kill-btn {
    padding: 4px 8px;
    background: var(--status-error, #f44336);
    border: none;
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    cursor: pointer;
  }

  .sandbox-item .kill-btn:hover {
    background: #d32f2f;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-secondary, #888);
    text-align: center;
  }

  .empty-state .icon {
    width: 48px;
    height: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .error-banner {
    padding: 12px;
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid rgba(244, 67, 54, 0.3);
    border-radius: 6px;
    color: #f44336;
    font-size: 13px;
  }

  .loading-spinner {
    display: flex;
    justify-content: center;
    padding: 24px;
  }

  .aggregates-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .aggregate-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary, #2d2d2d);
    border-radius: 16px;
    font-size: 12px;
    color: var(--text-secondary, #ccc);
  }

  .aggregate-chip .value {
    font-weight: 600;
    color: var(--text-primary, #fff);
  }
`;

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toString();
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function getProgressClass(percent: number): string {
  if (percent >= 90) {
    return "high";
  }
  if (percent >= 70) {
    return "medium";
  }
  return "low";
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================================================
// Render Functions
// ============================================================================

function renderMetricCard(params: {
  label: string;
  value: string;
  subValue?: string;
  percent?: number;
}): TemplateResult {
  const { label, value, subValue, percent } = params;

  return html`
    <div class="metric-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${subValue ? html`<div class="sub-value">${subValue}</div>` : nothing}
      ${
        percent !== undefined
          ? html`
            <div class="progress-bar">
              <div
                class="fill ${getProgressClass(percent)}"
                style="width: ${Math.min(100, percent)}%"
              ></div>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderSystemMetrics(metrics: SystemMetrics): TemplateResult {
  return html`
    <div class="metrics-grid">
      ${renderMetricCard({
        label: "CPU Usage",
        value: `${metrics.cpu.usagePercent.toFixed(1)}%`,
        subValue: `${metrics.cpu.cores} cores, load: ${metrics.cpu.loadAverage[0].toFixed(2)}`,
        percent: metrics.cpu.usagePercent,
      })}
      ${renderMetricCard({
        label: "Memory",
        value: formatBytes(metrics.memory.usedBytes),
        subValue: `of ${formatBytes(metrics.memory.totalBytes)} (${metrics.memory.usagePercent.toFixed(1)}%)`,
        percent: metrics.memory.usagePercent,
      })}
      ${renderMetricCard({
        label: "Disk",
        value: formatBytes(metrics.disk.usedBytes),
        subValue: `of ${formatBytes(metrics.disk.totalBytes)} (${metrics.disk.usagePercent.toFixed(1)}%)`,
        percent: metrics.disk.usagePercent,
      })}
      ${renderMetricCard({
        label: "Gateway Process",
        value: formatBytes(metrics.process.rssBytes),
        subValue: `PID ${metrics.process.pid}, up ${formatUptime(metrics.process.uptimeSeconds)}`,
      })}
      ${renderMetricCard({
        label: "Connections",
        value: metrics.activeConnections.toString(),
        subValue: "active clients",
      })}
      ${renderMetricCard({
        label: "Sandboxes",
        value: metrics.activeSandboxes.toString(),
        subValue: "active instances",
      })}
    </div>
  `;
}

function renderTenantAggregates(
  aggregates: AdminResourcesViewState["tenantAggregates"],
): TemplateResult {
  if (!aggregates) {
    return html``;
  }

  return html`
    <div class="aggregates-row">
      <div class="aggregate-chip">
        Tenants: <span class="value">${aggregates.totalCount}</span>
      </div>
      ${
        aggregates.overQuotaCount > 0
          ? html`
            <div class="aggregate-chip" style="color: #ff9800;">
              Over Quota: <span class="value">${aggregates.overQuotaCount}</span>
            </div>
          `
          : nothing
      }
      ${
        aggregates.blockedCount > 0
          ? html`
            <div class="aggregate-chip" style="color: #f44336;">
              Blocked: <span class="value">${aggregates.blockedCount}</span>
            </div>
          `
          : nothing
      }
      <div class="aggregate-chip">
        Total Tokens: <span class="value">${formatNumber(aggregates.totalTokensUsed)}</span>
      </div>
      <div class="aggregate-chip">
        Total Cost: <span class="value">${formatCost(aggregates.totalCostCents)}</span>
      </div>
      <div class="aggregate-chip">
        Total Disk: <span class="value">${formatBytes(aggregates.totalDiskUsageBytes)}</span>
      </div>
    </div>
  `;
}

function renderTenantsTable(params: {
  tenants: TenantSummary[];
  sortBy: AdminResourcesViewState["sortBy"];
  onSort: (field: AdminResourcesViewState["sortBy"]) => void;
}): TemplateResult {
  const { tenants, sortBy, onSort } = params;

  if (tenants.length === 0) {
    return html`
      <div class="empty-state">
        <div class="icon">${renderIcon("users", "icon")}</div>
        <p>No tenants found</p>
      </div>
    `;
  }

  return html`
    <table class="tenants-table">
      <thead>
        <tr>
          <th>Tenant</th>
          <th
            class="${sortBy === "tokensUsed" ? "sorted" : ""}"
            @click=${() => onSort("tokensUsed")}
          >
            Tokens
          </th>
          <th
            class="${sortBy === "costCents" ? "sorted" : ""}"
            @click=${() => onSort("costCents")}
          >
            Cost
          </th>
          <th
            class="${sortBy === "diskUsageBytes" ? "sorted" : ""}"
            @click=${() => onSort("diskUsageBytes")}
          >
            Disk
          </th>
          <th
            class="${sortBy === "activeSessions" ? "sorted" : ""}"
            @click=${() => onSort("activeSessions")}
          >
            Sessions
          </th>
          <th
            class="${sortBy === "lastActiveAt" ? "sorted" : ""}"
            @click=${() => onSort("lastActiveAt")}
          >
            Last Active
          </th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${tenants.map(
          (t) => html`
            <tr>
              <td>
                <strong>${t.displayName ?? t.tenantId}</strong>
                ${t.displayName ? html`<br /><small style="color: #888;">${t.tenantId}</small>` : nothing}
              </td>
              <td>
                ${formatNumber(t.tokensUsed)}
                ${
                  t.tokenLimit
                    ? html`<small style="color: #888;"> / ${formatNumber(t.tokenLimit)}</small>`
                    : nothing
                }
              </td>
              <td>
                ${formatCost(t.costCents)}
                ${
                  t.costLimitCents
                    ? html`<small style="color: #888;"> / ${formatCost(t.costLimitCents)}</small>`
                    : nothing
                }
              </td>
              <td>
                ${formatBytes(t.diskUsageBytes)}
                ${
                  t.diskLimitBytes
                    ? html`<small style="color: #888;"> / ${formatBytes(t.diskLimitBytes)}</small>`
                    : nothing
                }
              </td>
              <td>${t.activeSessions} / ${t.totalSessions}</td>
              <td>${t.lastActiveAt ? timeAgo(t.lastActiveAt) : "-"}</td>
              <td>
                ${
                  t.isBlocked
                    ? html`
                        <span class="status-badge blocked">Blocked</span>
                      `
                    : t.isOverQuota
                      ? html`
                          <span class="status-badge warning">Over Quota</span>
                        `
                      : html`
                          <span class="status-badge ok">OK</span>
                        `
                }
              </td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

function renderSandboxes(params: {
  sandboxes: AdminResourcesViewState["activeSandboxes"];
  onKill: (sandboxId: string) => void;
}): TemplateResult {
  const { sandboxes, onKill } = params;

  if (sandboxes.length === 0) {
    return html`
      <div class="empty-state">
        <p>No active sandboxes</p>
      </div>
    `;
  }

  return html`
    <div class="sandboxes-list">
      ${sandboxes.map(
        (s) => html`
          <div class="sandbox-item">
            <div class="info">
              <span class="sandbox-id">${s.sandboxId}</span>
              <span class="sandbox-meta">
                ${s.tenantId ? `Tenant: ${s.tenantId}` : ""}
                ${s.agentId ? ` | Agent: ${s.agentId}` : ""}
                ${s.pid ? ` | PID: ${s.pid}` : ""}
                | Started: ${timeAgo(s.createdAt)}
              </span>
            </div>
            <button class="kill-btn" @click=${() => onKill(s.sandboxId)}>Kill</button>
          </div>
        `,
      )}
    </div>
  `;
}

// ============================================================================
// Main Render Function
// ============================================================================

export function renderAdminResourcesView(params: {
  state: AdminResourcesViewState;
  onRefresh: () => void;
  onSortChange: (field: AdminResourcesViewState["sortBy"]) => void;
  onKillSandbox: (sandboxId: string) => void;
}): TemplateResult {
  const { state, onRefresh, onSortChange, onKillSandbox } = params;

  return html`
    <div class="admin-resources">
      <div class="resources-header">
        <h2>System Resources</h2>
        <div class="actions">
          ${
            state.lastRefresh
              ? html`<span style="font-size: 12px; color: #888;">
                Updated ${timeAgo(state.lastRefresh)}
              </span>`
              : nothing
          }
          <button class="refresh-btn" @click=${onRefresh} ?disabled=${state.loading}>
            ${renderIcon("refresh", "icon")} Refresh
          </button>
        </div>
      </div>

      ${state.error ? html`<div class="error-banner">${state.error}</div>` : nothing}

      ${
        state.loading && !state.systemMetrics
          ? html`
              <div class="loading-spinner">Loading...</div>
            `
          : nothing
      }

      ${state.systemMetrics ? renderSystemMetrics(state.systemMetrics) : nothing}

      <div class="section-title">Tenants</div>
      ${renderTenantAggregates(state.tenantAggregates)}
      ${renderTenantsTable({
        tenants: state.tenantSummaries,
        sortBy: state.sortBy,
        onSort: onSortChange,
      })}

      <div class="section-title">Active Sandboxes</div>
      ${renderSandboxes({
        sandboxes: state.activeSandboxes,
        onKill: onKillSandbox,
      })}
    </div>
  `;
}
