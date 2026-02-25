/**
 * xterm.js terminal web component.
 * OPENCLAWMU ADDITION: tenant terminal client component.
 *
 * Provides a browser-based terminal that connects to tenant sandboxes via WebSocket.
 *
 * Note: This component requires the xterm.css to be loaded. The styles are embedded
 * in the component's shadow DOM for encapsulation.
 */

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { LitElement, html, css, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// xterm.js base styles (embedded for shadow DOM compatibility)
const xtermBaseStyles = css`
  .xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
  }
  .xterm.focus,
  .xterm:focus {
    outline: none;
  }
  .xterm .xterm-helpers {
    position: absolute;
    top: 0;
    z-index: 5;
  }
  .xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    white-space: nowrap;
    overflow: hidden;
    resize: none;
  }
  .xterm .composition-view {
    background: #000;
    color: #fff;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
  }
  .xterm .composition-view.active {
    display: block;
  }
  .xterm .xterm-viewport {
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
  }
  .xterm .xterm-screen {
    position: relative;
  }
  .xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
  }
  .xterm .xterm-scroll-area {
    visibility: hidden;
  }
  .xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
  }
  .xterm.enable-mouse-events {
    cursor: default;
  }
  .xterm .xterm-cursor-pointer,
  .xterm.xterm-cursor-pointer {
    cursor: pointer;
  }
  .xterm.column-select.focus {
    cursor: crosshair;
  }
  .xterm .xterm-accessibility:not(.debug),
  .xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
  }
  .xterm .xterm-accessibility-tree:not(.debug) *::selection {
    color: transparent;
  }
  .xterm .xterm-accessibility-tree {
    user-select: text;
    white-space: pre;
  }
  .xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .xterm-dim {
    opacity: 1 !important;
  }
  .xterm-underline-1 {
    text-decoration: underline;
  }
  .xterm-underline-2 {
    text-decoration: double underline;
  }
  .xterm-underline-3 {
    text-decoration: wavy underline;
  }
  .xterm-underline-4 {
    text-decoration: dotted underline;
  }
  .xterm-underline-5 {
    text-decoration: dashed underline;
  }
  .xterm-overline {
    text-decoration: overline;
  }
  .xterm-overline.xterm-underline-1 {
    text-decoration: overline underline;
  }
  .xterm-overline.xterm-underline-2 {
    text-decoration: overline double underline;
  }
  .xterm-overline.xterm-underline-3 {
    text-decoration: overline wavy underline;
  }
  .xterm-overline.xterm-underline-4 {
    text-decoration: overline dotted underline;
  }
  .xterm-overline.xterm-underline-5 {
    text-decoration: overline dashed underline;
  }
  .xterm-strikethrough {
    text-decoration: line-through;
  }
  .xterm-screen .xterm-decoration-container .xterm-decoration {
    z-index: 6;
    position: absolute;
  }
  .xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
    z-index: 7;
  }
  .xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
  }
  .xterm-decoration-top {
    z-index: 2;
    position: relative;
  }
`;

export type TerminalMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "spawn"; shell?: string; env?: Record<string, string> }
  | { type: "close" };

export type TerminalEvent =
  | { type: "output"; terminalId: string; data: string }
  | { type: "exit"; terminalId: string; exitCode: number | null; signal: string | null }
  | { type: "spawned"; terminalId: string; pid: number; cols: number; rows: number }
  | { type: "error"; message: string };

@customElement("xterm-terminal")
export class XtermTerminal extends LitElement {
  static override styles = [
    xtermBaseStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: #1e1e1e;
        border-radius: 4px;
        overflow: hidden;
      }

      .terminal-container {
        width: 100%;
        height: 100%;
        padding: 4px;
        box-sizing: border-box;
      }

      .terminal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        background: #2d2d2d;
        border-bottom: 1px solid #3d3d3d;
        font-family: monospace;
        font-size: 12px;
        color: #ccc;
      }

      .terminal-header .status {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .terminal-header .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #666;
      }

      .terminal-header .status-dot.connected {
        background: #4caf50;
      }

      .terminal-header .status-dot.connecting {
        background: #ff9800;
        animation: pulse 1s infinite;
      }

      .terminal-header .status-dot.disconnected {
        background: #f44336;
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

      .terminal-body {
        width: 100%;
        height: calc(100% - 32px);
      }

      .terminal-actions {
        display: flex;
        gap: 4px;
      }

      .terminal-actions button {
        padding: 2px 8px;
        background: #3d3d3d;
        border: 1px solid #4d4d4d;
        border-radius: 3px;
        color: #ccc;
        font-size: 11px;
        cursor: pointer;
      }

      .terminal-actions button:hover {
        background: #4d4d4d;
      }

      .terminal-actions button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  @property({ type: String }) instanceId = "";
  @property({ type: String }) tenantId = "";
  @property({ type: String }) gatewayUrl = "";
  @property({ type: String }) token = "";
  @property({ type: Boolean }) autoConnect = false;

  @state() private status: "disconnected" | "connecting" | "connected" = "disconnected";
  @state() private terminalId: string | null = null;
  @state() private pid: number | null = null;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ws: WebSocket | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalContainer: HTMLElement | null = null;

  override connectedCallback() {
    super.connectedCallback();
    if (this.autoConnect) {
      void this.connect();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.disconnect();
  }

  protected override firstUpdated(_changedProperties: PropertyValues) {
    super.firstUpdated(_changedProperties);
    this.initTerminal();
  }

  private initTerminal() {
    this.terminalContainer = this.renderRoot.querySelector(".terminal-body");
    if (!this.terminalContainer) {
      return;
    }

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.terminalContainer);
    this.fitAddon.fit();

    // Handle user input
    this.terminal.onData((data) => {
      this.sendInput(data);
    });

    // Handle resize
    this.terminal.onResize(({ cols, rows }) => {
      this.sendResize(cols, rows);
    });

    // Observe container resize
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon) {
        this.fitAddon.fit();
      }
    });
    this.resizeObserver.observe(this.terminalContainer);

    // Welcome message
    this.terminal.writeln("OpenClaw Terminal");
    this.terminal.writeln('Type "connect" or click Connect to start a session.');
    this.terminal.writeln("");
  }

  async connect() {
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }

    if (!this.gatewayUrl) {
      this.terminal?.writeln("\x1b[31mError: Gateway URL not configured\x1b[0m");
      return;
    }

    this.status = "connecting";
    this.terminal?.writeln("\x1b[33mConnecting to gateway...\x1b[0m");

    try {
      // Build WebSocket URL
      const wsUrl = this.gatewayUrl.replace(/^http/, "ws");
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener("open", () => {
        this.terminal?.writeln("\x1b[32mConnected to gateway\x1b[0m");
        this.sendConnect();
      });

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      this.ws.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
        this.terminal?.writeln("\x1b[31mWebSocket error\x1b[0m");
        this.status = "disconnected";
      });

      this.ws.addEventListener("close", () => {
        this.terminal?.writeln("\x1b[33mDisconnected from gateway\x1b[0m");
        this.status = "disconnected";
        this.terminalId = null;
        this.pid = null;
      });
    } catch (error) {
      this.terminal?.writeln(`\x1b[31mConnection error: ${String(error)}\x1b[0m`);
      this.status = "disconnected";
    }
  }

  private sendConnect() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Send connect frame with authentication (required by gateway protocol)
    const connectRequest = {
      id: crypto.randomUUID(),
      method: "connect",
      params: {
        minProtocol: 1,
        maxProtocol: 3,
        client: {
          id: "xterm-terminal",
          version: "1.0.0",
          platform: navigator.platform ?? "web",
          mode: "terminal",
        },
        auth: this.token ? { token: this.token } : undefined,
        caps: [],
      },
    };

    this.ws.send(JSON.stringify(connectRequest));
  }

  private spawnTerminal() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const cols = this.terminal?.cols ?? 80;
    const rows = this.terminal?.rows ?? 24;

    // Send spawn request using gateway protocol
    const request = {
      id: crypto.randomUUID(),
      method: "terminal.spawn",
      params: {
        cols,
        rows,
        shell: "/bin/bash",
      },
    };

    this.ws.send(JSON.stringify(request));
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // Handle gateway response
      if (message.id && message.result) {
        // Handle connect (hello) response - now spawn terminal
        if (message.result.protocol !== undefined) {
          this.terminal?.writeln("\x1b[32mAuthenticated with gateway\x1b[0m");
          this.spawnTerminal();
          return;
        }
        // Handle terminal.spawn response
        if (message.result.terminalId) {
          this.terminalId = message.result.terminalId;
          this.pid = message.result.pid;
          this.status = "connected";
          this.terminal?.writeln(`\x1b[32mTerminal spawned (pid: ${this.pid})\x1b[0m`);
          this.terminal?.writeln("");
        }
        return;
      }

      // Handle error responses
      if (message.id && message.error) {
        this.terminal?.writeln(`\x1b[31mError: ${message.error.message || message.error}\x1b[0m`);
        return;
      }

      // Handle gateway events
      if (message.event === "terminal.output" && message.payload) {
        if (message.payload.terminalId === this.terminalId) {
          this.terminal?.write(message.payload.data);
        }
        return;
      }

      if (message.event === "terminal.exit" && message.payload) {
        if (message.payload.terminalId === this.terminalId) {
          const { exitCode, signal } = message.payload;
          this.terminal?.writeln("");
          this.terminal?.writeln(
            `\x1b[33mProcess exited (code: ${exitCode}, signal: ${signal})\x1b[0m`,
          );
          this.status = "disconnected";
          this.terminalId = null;
          this.pid = null;
        }
        return;
      }

      // Handle errors
      if (message.error) {
        this.terminal?.writeln(`\x1b[31mError: ${message.error.message}\x1b[0m`);
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  }

  private sendInput(data: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.terminalId) {
      return;
    }

    const request = {
      id: crypto.randomUUID(),
      method: "terminal.write",
      params: {
        terminalId: this.terminalId,
        data,
      },
    };

    this.ws.send(JSON.stringify(request));
  }

  private sendResize(cols: number, rows: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.terminalId) {
      return;
    }

    const request = {
      id: crypto.randomUUID(),
      method: "terminal.resize",
      params: {
        terminalId: this.terminalId,
        cols,
        rows,
      },
    };

    this.ws.send(JSON.stringify(request));
  }

  disconnect() {
    if (this.terminalId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const request = {
        id: crypto.randomUUID(),
        method: "terminal.close",
        params: {
          terminalId: this.terminalId,
        },
      };
      this.ws.send(JSON.stringify(request));
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.status = "disconnected";
    this.terminalId = null;
    this.pid = null;
  }

  clear() {
    this.terminal?.clear();
  }

  override render() {
    return html`
      <div class="terminal-container">
        <div class="terminal-header">
          <div class="status">
            <span class="status-dot ${this.status}"></span>
            <span>${this.getStatusText()}</span>
          </div>
          <div class="terminal-actions">
            <button
              @click=${() => this.connect()}
              ?disabled=${this.status === "connecting" || this.status === "connected"}
            >
              Connect
            </button>
            <button @click=${() => this.disconnect()} ?disabled=${this.status === "disconnected"}>
              Disconnect
            </button>
            <button @click=${() => this.clear()}>Clear</button>
          </div>
        </div>
        <div class="terminal-body"></div>
      </div>
    `;
  }

  private getStatusText(): string {
    switch (this.status) {
      case "disconnected":
        return "Disconnected";
      case "connecting":
        return "Connecting...";
      case "connected":
        return this.pid ? `Connected (PID: ${this.pid})` : "Connected";
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "xterm-terminal": XtermTerminal;
  }
}
