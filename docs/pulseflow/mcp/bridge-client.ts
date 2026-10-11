/**
 * WebSocket client for the PulseFlow bridge (Node/`ws`).
 *
 * The bridge protocol has no request ids — responses are just messages of a
 * type — so `waitFor(type)` resolves on the next message of that type.
 */
import WebSocket from "ws";
import { applyMessage, createSessionState, type McpSessionState } from "@/lib/mcp/session-state";
import type { BridgeClientMessage, BridgeServerMessage } from "@/lib/types";

interface Waiter {
  type: BridgeServerMessage["type"];
  predicate?: (msg: BridgeServerMessage) => boolean;
  resolve: (msg: BridgeServerMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeClientOptions {
  url: string;
  onMessage?: (state: McpSessionState, msg: BridgeServerMessage) => void;
  log?: (message: string) => void;
}

export class BridgeClient {
  readonly state: McpSessionState = createSessionState();
  private readonly url: string;
  private readonly onMessage?: BridgeClientOptions["onMessage"];
  private readonly log: (message: string) => void;
  private ws: WebSocket | null = null;
  private waiters: Waiter[] = [];
  private pending: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: BridgeClientOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.log = options.log ?? (() => {});
  }

  connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.state.bridgeReady = true;
      this.log(`bridge connected: ${this.url}`);
      this.flushPending();
    });
    ws.on("close", () => {
      this.state.bridgeReady = false;
      this.state.status = "idle";
      this.state.statusMessage = "Bridge disconnected";
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
        // Don't hold the event loop open on a dead bridge; the stdio transport
        // keeps the process alive while the MCP client is connected.
        this.reconnectTimer.unref?.();
      }
    });
    ws.on("error", (err) => {
      this.log(`bridge error: ${err instanceof Error ? err.message : String(err)}`);
    });
    ws.on("message", (data) => {
      let msg: BridgeServerMessage;
      try {
        msg = JSON.parse(String(data)) as BridgeServerMessage;
      } catch {
        return;
      }
      applyMessage(this.state, msg);
      this.onMessage?.(this.state, msg);
      this.resolveWaiters(msg);
    });
  }

  private resolveWaiters(msg: BridgeServerMessage): void {
    this.waiters = this.waiters.filter((w) => {
      if (w.type !== msg.type) return true;
      if (w.predicate && !w.predicate(msg)) return true;
      clearTimeout(w.timer);
      w.resolve(msg);
      return false;
    });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Sends a message. If the socket is still connecting, the message is queued
   * and flushed on open — tools can be called immediately after startup.
   */
  send(msg: BridgeClientMessage): void {
    if (this.disposed) throw new Error("Bridge client is disposed");
    const text = JSON.stringify(msg);
    if (this.isOpen()) {
      this.ws!.send(text);
    } else {
      if (this.pending.length > 50) this.pending.shift();
      this.pending.push(text);
    }
  }

  private flushPending(): void {
    if (!this.isOpen() || this.pending.length === 0) return;
    const queued = this.pending;
    this.pending = [];
    for (const text of queued) {
      try {
        this.ws!.send(text);
      } catch {
        break;
      }
    }
  }

  waitFor(
    type: BridgeServerMessage["type"],
    timeoutMs = 8000,
    predicate?: (msg: BridgeServerMessage) => boolean,
  ): Promise<BridgeServerMessage | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      this.waiters.push({ type, predicate, resolve, timer });
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiters = [];
    this.ws?.close();
    this.ws = null;
  }
}
