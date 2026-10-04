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

export class PulseBridgeClient {
  private ws: WebSocket | null = null;
  private handlers: BridgeHandlers;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = (e) => this.handlers.onError?.(e);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as BridgeServerMessage;
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

  dispose() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
