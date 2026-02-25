/**
 * Terminal controller for managing web terminal sessions.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";

export type TerminalSession = {
  terminalId: string;
  tenantId: string;
  pid: number;
  createdAt: number;
  lastActivityAt: number;
};

export type TerminalControllerState = {
  sessions: TerminalSession[];
  loading: boolean;
  error: string | null;
};

/**
 * Controller for managing terminal sessions via the gateway API.
 */
export class TerminalController implements ReactiveController {
  private host: ReactiveControllerHost;
  private gatewayUrl: string;
  private token: string;

  state: TerminalControllerState = {
    sessions: [],
    loading: false,
    error: null,
  };

  constructor(host: ReactiveControllerHost, options: { gatewayUrl: string; token: string }) {
    this.host = host;
    this.gatewayUrl = options.gatewayUrl;
    this.token = options.token;
    host.addController(this);
  }

  hostConnected() {
    // Could auto-load sessions here
  }

  hostDisconnected() {
    // Cleanup if needed
  }

  /**
   * Lists all terminal sessions for the current tenant.
   */
  async listSessions(): Promise<TerminalSession[]> {
    this.state = { ...this.state, loading: true, error: null };
    this.host.requestUpdate();

    try {
      const response = await this.callGateway("terminal.list", {});
      const sessions = (response.sessions ?? []) as TerminalSession[];
      this.state = { ...this.state, sessions, loading: false };
      this.host.requestUpdate();
      return sessions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, loading: false, error: message };
      this.host.requestUpdate();
      throw error;
    }
  }

  /**
   * Closes a terminal session.
   */
  async closeSession(terminalId: string): Promise<void> {
    try {
      await this.callGateway("terminal.close", { terminalId });
      // Remove from local state
      this.state = {
        ...this.state,
        sessions: this.state.sessions.filter((s) => s.terminalId !== terminalId),
      };
      this.host.requestUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, error: message };
      this.host.requestUpdate();
      throw error;
    }
  }

  /**
   * Calls a gateway method.
   */
  private async callGateway(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.gatewayUrl}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gateway request failed: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message ?? "Unknown error");
    }

    return data.result ?? {};
  }
}
