"use client";

import type { BridgeClientMessage, BridgeServerMessage } from "@/lib/types";

function bridgeUrl(): string {
  if (typeof window === "undefined") return "ws://127.0.0.1:3847/bridge";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = process.env.NEXT_PUBLIC_BRIDGE_HOST ?? window.location.hostname;
  const port = process.env.NEXT_PUBLIC_BRIDGE_PORT ?? "3847";
  return `${proto}//${host}:${port}/bridge`;
}

export type BridgeHandlers = {
  onMessage: (msg: BridgeServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
};

interface BridgeWaiter {
  type: BridgeServerMessage["type"];
  predicate?: (msg: BridgeServerMessage) => boolean;
  resolve: (msg: BridgeServerMessage | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PulseBridgeClient {
  private ws: WebSocket | null = null;
  private handlers: BridgeHandlers;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: BridgeWaiter[] = [];

  constructor(handlers: BridgeHandlers) {
    this.handlers = handlers;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(bridgeUrl());
    this.ws = ws;
    ws.onopen = () => this.handlers.onOpen?.();
    ws.onclose = () => {
      this.handlers.onClose?.();
      this.resolveWaiters(); // wake awaiting requests with null
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = (e) => this.handlers.onError?.(e);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as BridgeServerMessage;
        this.resolveWaiters(msg);
        this.handlers.onMessage(msg);
      } catch {
        /* ignore */
      }
    };
  }

  send(msg: BridgeClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge socket is not connected yet");
    }
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Resolves with the next incoming message of `type` (optionally matching
   * `predicate`), or `null` on timeout / disconnect. Lets callers await a
   * specific bridge reply without threading state through React.
   */
  request(
    type: BridgeServerMessage["type"],
    options?: { timeoutMs?: number; predicate?: (msg: BridgeServerMessage) => boolean },
  ): Promise<BridgeServerMessage | null> {
    const timeoutMs = options?.timeoutMs ?? 8000;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({ type, predicate: options?.predicate, resolve, timer });
    });
  }

  private resolveWaiters(msg?: BridgeServerMessage) {
    this.waiters = this.waiters.filter((w) => {
      if (msg && w.type !== msg.type) return true;
      if (msg && w.predicate && !w.predicate(msg)) return true;
      clearTimeout(w.timer);
      w.resolve(msg ?? null);
      return false;
    });
  }

  dispose() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.resolveWaiters();
    this.ws?.close();
    this.ws = null;
  }
}
