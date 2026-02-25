/**
 * Terminal view - Multi-terminal interface for tenant sandbox access.
 */

import { html, css, type TemplateResult } from "lit";
import { renderIcon } from "../icons.js";
// Import to register the xterm-terminal custom element
import "../terminal/xterm-terminal.js";

export type TerminalInstance = {
  id: string;
  terminalId: string | null;
  status: "disconnected" | "connecting" | "connected";
  pid: number | null;
  title: string;
};

export type TerminalViewState = {
  instances: TerminalInstance[];
  activeInstanceId: string | null;
  gatewayConnected: boolean;
  gatewayUrl: string;
  token: string;
};

export const terminalViewStyles = css`
  .terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary, #1e1e1e);
  }

  .terminal-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    background: var(--bg-secondary, #252526);
    border-bottom: 1px solid var(--border-color, #3d3d3d);
    overflow-x: auto;
  }

  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary, #2d2d2d);
    border: 1px solid var(--border-color, #3d3d3d);
    border-radius: 4px;
    color: var(--text-secondary, #ccc);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .terminal-tab:hover {
    background: var(--bg-hover, #3d3d3d);
  }

  .terminal-tab.active {
    background: var(--bg-active, #094771);
    border-color: var(--accent-color, #007acc);
    color: var(--text-primary, #fff);
  }

  .terminal-tab .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--status-disconnected, #666);
  }

  .terminal-tab .status-dot.connected {
    background: var(--status-connected, #4caf50);
  }

  .terminal-tab .status-dot.connecting {
    background: var(--status-connecting, #ff9800);
    animation: pulse 1s infinite;
  }

  .terminal-tab .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: transparent;
    border: none;
    color: var(--text-secondary, #ccc);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }

  .terminal-tab .close-btn:hover {
    background: var(--bg-hover, #4d4d4d);
    color: var(--text-primary, #fff);
  }

  .add-terminal-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--bg-tertiary, #2d2d2d);
    border: 1px dashed var(--border-color, #3d3d3d);
    border-radius: 4px;
    color: var(--text-secondary, #ccc);
    cursor: pointer;
    font-size: 18px;
  }

  .add-terminal-btn:hover {
    background: var(--bg-hover, #3d3d3d);
    border-style: solid;
    color: var(--text-primary, #fff);
  }

  .terminal-content {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .terminal-panel {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: none;
  }

  .terminal-panel.active {
    display: block;
  }

  .terminal-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary, #888);
    text-align: center;
    padding: 24px;
  }

  .terminal-empty .icon {
    width: 48px;
    height: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .terminal-empty h3 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--text-primary, #ccc);
  }

  .terminal-empty p {
    margin: 0 0 16px;
    font-size: 13px;
  }

  .terminal-empty button {
    padding: 8px 16px;
    background: var(--accent-color, #007acc);
    border: none;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
  }

  .terminal-empty button:hover {
    background: var(--accent-hover, #005a9e);
  }

  .terminal-not-available {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary, #888);
    text-align: center;
    padding: 24px;
  }

  .terminal-not-available h3 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--text-warning, #ff9800);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

export function renderTerminalView(params: {
  state: TerminalViewState;
  onAddTerminal: () => void;
  onCloseTerminal: (instanceId: string) => void;
  onSelectTerminal: (instanceId: string) => void;
}): TemplateResult {
  const { state, onAddTerminal, onCloseTerminal, onSelectTerminal } = params;

  if (!state.gatewayConnected) {
    return html`
      <div class="terminal-view">
        <div class="terminal-not-available">
          <h3>Gateway Not Connected</h3>
          <p>Connect to a gateway to access terminal sessions.</p>
        </div>
      </div>
    `;
  }

  if (state.instances.length === 0) {
    return html`
      <div class="terminal-view">
        <div class="terminal-empty">
          <div class="icon">${renderIcon("terminal", "icon")}</div>
          <h3>No Terminal Sessions</h3>
          <p>Start a new terminal to access your sandbox environment.</p>
          <button @click=${onAddTerminal}>New Terminal</button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="terminal-view">
      <div class="terminal-tabs">
        ${state.instances.map(
          (instance) => html`
            <div
              class="terminal-tab ${instance.id === state.activeInstanceId ? "active" : ""}"
              @click=${() => onSelectTerminal(instance.id)}
            >
              <span class="status-dot ${instance.status}"></span>
              <span class="title">${instance.title}</span>
              <button
                class="close-btn"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  onCloseTerminal(instance.id);
                }}
              >
                &times;
              </button>
            </div>
          `,
        )}
        <button class="add-terminal-btn" @click=${onAddTerminal} title="New Terminal">+</button>
      </div>
      <div class="terminal-content">
        ${state.instances.map(
          (instance) => html`
            <div
              class="terminal-panel ${instance.id === state.activeInstanceId ? "active" : ""}"
              id="terminal-${instance.id}"
            >
              <xterm-terminal
                .instanceId=${instance.id}
                .gatewayUrl=${state.gatewayUrl}
                .token=${state.token}
                .autoConnect=${true}
              ></xterm-terminal>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}
