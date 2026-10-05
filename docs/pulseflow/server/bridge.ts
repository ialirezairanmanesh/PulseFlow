/**
 * PulseFlow WebSocket bridge
 * Proxies browser clients ↔ Dart VM Service WebSocket and streams
 * simplified performance metrics for the dashboard.
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { discoverRunningApps } from "./discover";
import {
  mockCpuProfile,
  transformCpuSamples,
  type CpuProfileSummary,
} from "./cpu-profile";

const BRIDGE_PORT = Number(process.env.PULSEFLOW_BRIDGE_PORT ?? 3847);
const FRAME_BUDGET_MS = 16.67;

type ClientMsg =
  | { type: "connect"; url: string }
  | { type: "disconnect" }
  | { type: "mock" }
  | { type: "discover" }
  | { type: "refreshExtensions" }
  | { type: "stress"; action: string; params?: Record<string, unknown> }
  | { type: "hotWidgetsControl"; action: "freeze" | "unfreeze" | "reset" }
  | { type: "cpuRecord"; action: "start" | "stop"; durationMs?: number }
  | {
      type: "scenario";
      action: "list" | "run" | "stop";
      id?: string;
      params?: Record<string, unknown>;
    }
  | {
      type: "memorySnapshot";
      action: "capture" | "diff" | "retainingPath";
      snapshotId?: string;
      classId?: string;
      objectId?: string;
    }
  | { type: "timelineExport"; action: "perfetto"; durationMs?: number }
  | { type: "networkControl"; action: "refresh" | "clear" | "enable" }
  | {
      type: "debugOptions";
      action: "get" | "set";
      id?: string;
      enabled?: boolean;
    };

const DEBUG_OPTION_DEFS = [
  { id: "performanceOverlay", method: "ext.flutter.showPerformanceOverlay", kind: "bool" },
  { id: "debugPaint", method: "ext.flutter.debugPaint", kind: "bool" },
  { id: "debugPaintBaselines", method: "ext.flutter.debugPaintBaselinesEnabled", kind: "bool" },
  { id: "repaintRainbow", method: "ext.flutter.repaintRainbow", kind: "bool" },
  { id: "invertOversizedImages", method: "ext.flutter.invertOversizedImages", kind: "bool" },
  { id: "debugBanner", method: "ext.flutter.debugAllowBanner", kind: "bool" },
  { id: "slowAnimations", method: "ext.flutter.timeDilation", kind: "timeDilation" },
] as const;

const SLOW_ANIMATION_DILATION = 5;

interface CapabilityMap {
  cpuSamples: boolean;
  clearCpuSamples: boolean;
  allocationProfile: boolean;
  retainingPath: boolean;
  instances: boolean;
  perfettoTimeline: boolean;
  perfettoCpuSamples: boolean;
  vmTimelineMicros: boolean;
  profilerFlag: boolean;
  httpProfile: boolean;
  socketProfile: boolean;
  pulseExtension: boolean;
  scenarios: boolean;
  widgetProbe: boolean;
}

interface AllocationClassStat {
  className: string;
  instances: number;
  bytes: number;
  classId?: string;
}

interface MemorySnapshot {
  id: string;
  t: number;
  heapMb: number;
  externalMb: number;
  classes: AllocationClassStat[];
}

interface ScenarioInfo {
  id: string;
  label: string;
  description: string;
}

const DEFAULT_CAPS: CapabilityMap = {
  cpuSamples: false,
  clearCpuSamples: false,
  allocationProfile: false,
  retainingPath: false,
  instances: false,
  perfettoTimeline: false,
  perfettoCpuSamples: false,
  vmTimelineMicros: false,
  profilerFlag: false,
  httpProfile: false,
  socketProfile: false,
  pulseExtension: false,
  scenarios: false,
  widgetProbe: false,
};

const MOCK_SCENARIOS: ScenarioInfo[] = [
  {
    id: "scrollStorm",
    label: "Scroll storm",
    description: "Rapid scroll jumps on primary scrollables",
  },
  {
    id: "routeThrash",
    label: "Route thrash",
    description: "Push/pop lightweight routes repeatedly",
  },
  {
    id: "listFlood",
    label: "List flood",
    description: "Burst-append invoice items into stress state",
  },
  {
    id: "animationFlood",
    label: "Animation flood",
    description: "Spawn repeating animation controllers",
  },
  {
    id: "retainMemory",
    label: "Retain memory",
    description: "Allocate and retain byte buffers",
  },
  {
    id: "networkBurst",
    label: "Network burst",
    description: "Stubbed unless the app registers a network hook",
  },
];

interface WidgetRebuildStat {
  id: string;
  name: string;
  route: string;
  keyLabel?: string;
  rebuildsSession: number;
  rebuildsWindow: number;
  ratePerSec: number;
  share: number;
  lastSeenMs: number;
  isFramework?: boolean;
  duringJank?: boolean;
}

interface ScreenRebuildStat {
  route: string;
  rebuildsWindow: number;
  ratePerSec: number;
  share: number;
  topWidgets: WidgetRebuildStat[];
}

interface HotWidgetsPayload {
  type: "hotWidgets";
  available: boolean;
  windowMs: number;
  totalRebuildsWindow: number;
  totalRebuildsSession: number;
  totalRebuilds?: number;
  currentRoute?: string;
  widgets: WidgetRebuildStat[];
  screens: ScreenRebuildStat[];
  frozen?: boolean;
  duringJank?: boolean;
  message?: string;
}

interface Session {
  client: WebSocket;
  vm?: WebSocket;
  mode: "idle" | "live" | "mock";
  isolateId?: string;
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  seq: number;
  pollTimer?: ReturnType<typeof setInterval>;
  mockTimer?: ReturnType<typeof setInterval>;
  hotWidgetTimer?: ReturnType<typeof setInterval>;
  lastFrameMs: number;
  lastBuildMs: number;
  lastRasterMs: number;
  lastVsyncMs: number;
  jankWindow: number[];
  extensionMethods: string[];
  httpProfileSupported: boolean | null;
  widgetProbeAvailable: boolean | null;
  hotWidgetsFrozen: boolean;
  /** While Date.now() < this, suppress hot-widget samples (Record quiet window) */
  recordQuietUntil: number;
  lastHotWidgetsPayload?: HotWidgetsPayload;
  mockSessionRebuilds: Map<string, number>;
  caps: CapabilityMap;
  cpuRecording: boolean;
  cpuRecordTimer?: ReturnType<typeof setTimeout>;
  cpuRecordStartedAt?: number;
  cpuRecordOriginMicros?: number;
  cpuProfileCache?: CpuProfileSummary;
  memorySnapshots: MemorySnapshot[];
  seenHttpIds: Set<string>;
  scenarioRunning: string | null;
  scenarioTimer?: ReturnType<typeof setTimeout>;
  timelineMarkers: Array<{
    id: string;
    t: number;
    kind: "jank" | "gc" | "shader" | "other";
    label: string;
  }>;
  mockDebugOptions: Record<string, boolean>;
}

function send(client: WebSocket, payload: unknown) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function isValidVmUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

async function rpc(
  session: Session,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 8000,
) {
  if (!session.vm || session.vm.readyState !== WebSocket.OPEN) {
    throw new Error("VM Service is not connected");
  }
  const id = String(++session.seq);
  const message = { jsonrpc: "2.0", id, method, params };
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, timeoutMs);
    session.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    session.vm!.send(JSON.stringify(message));
  });
}

function clearTimers(session: Session) {
  if (session.pollTimer) clearInterval(session.pollTimer);
  if (session.mockTimer) clearInterval(session.mockTimer);
  if (session.hotWidgetTimer) clearInterval(session.hotWidgetTimer);
  if (session.cpuRecordTimer) clearTimeout(session.cpuRecordTimer);
  if (session.scenarioTimer) clearTimeout(session.scenarioTimer);
  session.pollTimer = undefined;
  session.mockTimer = undefined;
  session.hotWidgetTimer = undefined;
  session.cpuRecordTimer = undefined;
  session.scenarioTimer = undefined;
  session.cpuRecording = false;
  session.scenarioRunning = null;
}

function usToMs(us: number): number {
  if (!Number.isFinite(us) || us <= 0) return 0;
  // Flutter.Frame fields are microseconds; guard if already ms-sized
  return us > 200 ? us / 1000 : us;
}

function framePressure(buildMs: number, rasterMs: number, frameMs: number): number {
  const cost = Math.max(frameMs, buildMs + rasterMs);
  return Number(Math.min(100, Math.max(1, (cost / FRAME_BUDGET_MS) * 70)).toFixed(1));
}

function disconnectVm(session: Session, reason?: string) {
  clearTimers(session);
  if (session.vm) {
    try {
      session.vm.close();
    } catch {
      /* ignore */
    }
    session.vm = undefined;
  }
  session.mode = "idle";
  session.isolateId = undefined;
  session.extensionMethods = [];
  session.httpProfileSupported = null;
  session.widgetProbeAvailable = null;
  session.hotWidgetsFrozen = false;
  session.recordQuietUntil = 0;
  session.caps = { ...DEFAULT_CAPS };
  session.cpuProfileCache = undefined;
  session.cpuRecordOriginMicros = undefined;
  session.cpuRecordStartedAt = undefined;
  session.memorySnapshots = [];
  session.seenHttpIds.clear();
  session.timelineMarkers = [];
  session.lastHotWidgetsPayload = undefined;
  session.mockSessionRebuilds.clear();
  session.lastBuildMs = 0;
  session.lastRasterMs = 0;
  session.lastVsyncMs = 0;
  for (const [, p] of session.pending) p.reject(new Error("disconnected"));
  session.pending.clear();
  if (reason) {
    send(session.client, { type: "status", status: "disconnected", message: reason });
  }
}

const MOCK_WIDGET_DEFS: Array<{
  name: string;
  route: string;
  keyLabel?: string;
  isFramework?: boolean;
  base: number;
}> = [
  { name: "InvoiceCard", route: "/invoices", keyLabel: "ValueKey(row)", base: 36 },
  { name: "InvoiceListTile", route: "/invoices", base: 28 },
  { name: "AnimatedBuilder", route: "/dashboard", base: 22 },
  { name: "StreamBuilder", route: "/dashboard", base: 18 },
  { name: "ChartPainter", route: "/reports", base: 14 },
  { name: "Text", route: "/invoices", isFramework: true, base: 40 },
  { name: "Padding", route: "/invoices", isFramework: true, base: 30 },
  { name: "ListView", route: "/invoices", base: 12 },
];

function emitMockHotWidgets(session: Session) {
  // Freeze / Record quiet: do not emit new ranks
  if (session.hotWidgetsFrozen) {
    return;
  }
  if (Date.now() < session.recordQuietUntil) {
    return;
  }

  const windowMs = 10000;
  const windowSec = windowMs / 1000;
  const duringJank = session.lastFrameMs > FRAME_BUDGET_MS;
  const widgets: WidgetRebuildStat[] = MOCK_WIDGET_DEFS.map((def) => {
    const id = `${def.route}|${def.name}|${def.keyLabel ?? ""}`;
    const rebuildsWindow = Math.max(
      0,
      Math.floor(def.base - Math.random() * 8 + (duringJank ? 10 : 0)),
    );
    const prev = session.mockSessionRebuilds.get(id) ?? 0;
    const rebuildsSession = prev + rebuildsWindow;
    session.mockSessionRebuilds.set(id, rebuildsSession);
    return {
      id,
      name: def.name,
      route: def.route,
      keyLabel: def.keyLabel,
      rebuildsSession,
      rebuildsWindow,
      ratePerSec: Number((rebuildsWindow / windowSec).toFixed(2)),
      share: 0,
      lastSeenMs: Math.floor(Math.random() * 800),
      isFramework: def.isFramework ?? false,
      duringJank,
    };
  });

  const totalWindow = widgets.reduce((a, w) => a + w.rebuildsWindow, 0);
  const totalSession = widgets.reduce((a, w) => a + w.rebuildsSession, 0);
  for (const w of widgets) {
    w.share = totalWindow > 0 ? Number(((w.rebuildsWindow / totalWindow) * 100).toFixed(1)) : 0;
  }
  widgets.sort((a, b) => b.rebuildsWindow - a.rebuildsWindow);

  const byRoute = new Map<string, WidgetRebuildStat[]>();
  for (const w of widgets) {
    const list = byRoute.get(w.route) ?? [];
    list.push(w);
    byRoute.set(w.route, list);
  }
  const screens: ScreenRebuildStat[] = [...byRoute.entries()]
    .map(([route, list]) => {
      const rebuildsWindow = list.reduce((a, w) => a + w.rebuildsWindow, 0);
      return {
        route,
        rebuildsWindow,
        ratePerSec: Number((rebuildsWindow / windowSec).toFixed(2)),
        share: totalWindow > 0 ? Number(((rebuildsWindow / totalWindow) * 100).toFixed(1)) : 0,
        topWidgets: list.slice(0, 5),
      };
    })
    .sort((a, b) => b.rebuildsWindow - a.rebuildsWindow);

  const payload: HotWidgetsPayload = {
    type: "hotWidgets",
    available: true,
    windowMs,
    totalRebuildsWindow: totalWindow,
    totalRebuildsSession: totalSession,
    totalRebuilds: totalWindow,
    widgets,
    screens,
    frozen: session.hotWidgetsFrozen,
    duringJank,
    message: "Demo widget rebuild ranks",
  };
  session.lastHotWidgetsPayload = payload;
  send(session.client, payload);
}

function emitMockMetrics(session: Session) {
  const t = Date.now();
  const wave = Math.sin(t / 900) * 18 + Math.sin(t / 2400) * 10;
  const spike = Math.random() > 0.92 ? 20 + Math.random() * 40 : 0;
  const buildMs = Math.max(2, 6 + wave * 0.12 + spike * 0.35 + Math.random() * 2);
  const rasterMs = Math.max(1.5, 4 + wave * 0.08 + spike * 0.2 + Math.random() * 1.5);
  const vsyncMs = Math.max(0.2, 0.8 + Math.random() * 0.6);
  const frameMs = buildMs + rasterMs + vsyncMs * 0.3;
  const jank = frameMs > FRAME_BUDGET_MS ? 1 : 0;
  const heapMb = 42 + Math.sin(t / 5000) * 6 + Math.random() * 2 + (spike ? 8 : 0);
  const pressure = framePressure(buildMs, rasterMs, frameMs);

  session.lastFrameMs = frameMs;
  session.lastBuildMs = buildMs;
  session.lastRasterMs = rasterMs;
  session.lastVsyncMs = vsyncMs;

  send(session.client, {
    type: "metrics",
    point: {
      t,
      cpu: pressure,
      framePressure: pressure,
      frameMs: Number(frameMs.toFixed(2)),
      buildMs: Number(buildMs.toFixed(2)),
      rasterMs: Number(rasterMs.toFixed(2)),
      vsyncMs: Number(vsyncMs.toFixed(2)),
      jank,
      heapMb: Number(heapMb.toFixed(2)),
      externalMb: Number((8 + Math.random() * 2).toFixed(2)),
    },
  });

  if (Math.random() > 0.94) {
    send(session.client, {
      type: "gc",
      event: {
        id: randomUUID(),
        t,
        reason: Math.random() > 0.5 ? "scavenge" : "mark-sweep",
        isolate: "main",
      },
    });
  }

  if (Math.random() > 0.88) {
    const latency = 40 + Math.random() * 180 + (spike ? 120 : 0);
    send(session.client, {
      type: "network",
      available: true,
      request: {
        id: randomUUID(),
        t,
        method: ["GET", "POST", "PUT"][Math.floor(Math.random() * 3)],
        uri: `/api/invoices?page=${Math.floor(Math.random() * 8)}`,
        latencyMs: Number(latency.toFixed(1)),
        requestBytes: Math.floor(120 + Math.random() * 800),
        responseBytes: Math.floor(900 + Math.random() * 24000),
        status: Math.random() > 0.95 ? 500 : 200,
      },
    });
  }
}

function mockCapabilities(): CapabilityMap {
  return {
    cpuSamples: true,
    clearCpuSamples: true,
    allocationProfile: true,
    retainingPath: true,
    instances: true,
    perfettoTimeline: true,
    perfettoCpuSamples: false,
    vmTimelineMicros: true,
    profilerFlag: true,
    httpProfile: true,
    socketProfile: true,
    pulseExtension: true,
    scenarios: true,
    widgetProbe: true,
  };
}

function startMock(session: Session) {
  disconnectVm(session);
  session.mode = "mock";
  session.widgetProbeAvailable = true;
  session.hotWidgetsFrozen = false;
  session.recordQuietUntil = 0;
  session.mockSessionRebuilds.clear();
  session.lastHotWidgetsPayload = undefined;
  session.caps = mockCapabilities();
  session.memorySnapshots = [];
  session.seenHttpIds.clear();
  session.timelineMarkers = [];
  send(session.client, {
    type: "status",
    status: "connected",
    mode: "mock",
    message: "Demo mode — synthetic metrics (no Flutter app connected)",
    isolateName: "mock-isolate",
  });
  send(session.client, {
    type: "capabilities",
    caps: session.caps,
    message: "Demo capabilities — all lab surfaces enabled with fake data",
  });
  send(session.client, {
    type: "extension",
    info: {
      available: true,
      methods: [
        "ext.pulseflow.injectInvoices",
        "ext.pulseflow.spikeCpu",
        "ext.pulseflow.allocateMemory",
        "ext.pulseflow.getHotWidgets",
        "ext.pulseflow.listScenarios",
        "ext.pulseflow.runScenario",
        "ext.pulseflow.stopScenario",
      ],
      message: "Mock stress actions and hot widgets simulate load locally",
    },
  });
  send(session.client, {
    type: "scenarioStatus",
    scenarios: MOCK_SCENARIOS,
    running: null,
    message: "Demo scenarios ready",
  });
  send(session.client, {
    type: "network",
    available: true,
    message: "Mock network profile enabled",
  });
  for (const key of Object.keys(session.mockDebugOptions)) {
    session.mockDebugOptions[key] = false;
  }
  emitMockDebugOptions(session);
  emitMockHotWidgets(session);
  session.mockTimer = setInterval(() => emitMockMetrics(session), 500);
  session.hotWidgetTimer = setInterval(() => emitMockHotWidgets(session), 1000);
}

async function listenStreams(session: Session) {
  for (const streamId of ["Extension", "GC", "Timeline"]) {
    try {
      await rpc(session, "streamListen", { streamId });
    } catch {
      /* stream may already be listened or unsupported */
    }
  }
}

async function resolveIsolate(session: Session): Promise<string> {
  const vm = (await rpc(session, "getVM")) as {
    result?: {
      isolates?: Array<{ id: string; name?: string; isSystemIsolate?: boolean }>;
    };
  };
  const isolates = vm.result?.isolates ?? [];
  const main =
    isolates.find((i) => !i.isSystemIsolate && /main/i.test(i.name ?? "")) ??
    isolates.find((i) => !i.isSystemIsolate) ??
    isolates[0];
  if (!main) throw new Error("No Dart isolate found on this VM Service");
  session.isolateId = main.id;
  return main.name ?? main.id;
}

function parseExtensionJson(payload: unknown): Record<string, unknown> | null {
  const root = payload as { result?: { json?: string; type?: string } & Record<string, unknown> };
  const result = root.result;
  if (!result) return null;
  if (typeof result.json === "string") {
    try {
      return JSON.parse(result.json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof result === "object") return result as Record<string, unknown>;
  return null;
}

async function refreshExtensions(session: Session) {
  if (!session.isolateId) return;
  try {
    const isolate = (await rpc(session, "getIsolate", {
      isolateId: session.isolateId,
    })) as { result?: { extensionRPCs?: string[] } };
    const methods = isolate.result?.extensionRPCs ?? [];
    session.extensionMethods = methods;
    const pulse = methods.filter((m) => m.startsWith("ext.pulseflow."));
    const hasHotWidgets = methods.includes("ext.pulseflow.getHotWidgets");
    session.widgetProbeAvailable = hasHotWidgets;
    send(session.client, {
      type: "extension",
      info: {
        available: pulse.length > 0,
        methods: pulse.length > 0 ? pulse : methods.filter((m) => m.includes("flutter")).slice(0, 8),
        message:
          pulse.length > 0
            ? hasHotWidgets
              ? "PulseFlow extension detected — widget probe ready"
              : "PulseFlow stress extension detected (update stub for hot widgets)"
            : "PulseFlow extension not registered — paste examples/pulseflow_extension.dart into your Flutter app",
      },
    });
    if (!hasHotWidgets) {
      send(session.client, {
        type: "hotWidgets",
        available: false,
        windowMs: 0,
        totalRebuildsWindow: 0,
        totalRebuildsSession: 0,
        widgets: [],
        screens: [],
        message:
          "Hot widgets unavailable — add pulseflow_extension.dart to the app, hot-restart, and Connect again",
      });
    }
  } catch (err) {
    session.widgetProbeAvailable = false;
    send(session.client, {
      type: "extension",
      info: {
        available: false,
        methods: [],
        message: err instanceof Error ? err.message : "Could not list extensions",
      },
    });
  }
}

async function startWidgetProbe(session: Session) {
  if (!session.isolateId || !session.extensionMethods.includes("ext.pulseflow.startWidgetProbe")) {
    return;
  }
  try {
    await rpc(session, "ext.pulseflow.startWidgetProbe", {
      isolateId: session.isolateId,
    });
  } catch {
    /* probe may already be running */
  }
}

function mapWidgetStat(
  raw: Record<string, unknown>,
  totalWindow: number,
  windowMs: number,
  duringJank: boolean,
): WidgetRebuildStat {
  const name = String(raw.name ?? "Widget");
  const route = String(raw.route ?? "(unnamed)");
  const keyLabel = raw.keyLabel != null ? String(raw.keyLabel) : undefined;
  const id = String(raw.id ?? `${route}|${name}|${keyLabel ?? ""}`);
  const rebuildsWindow =
    Number(raw.rebuildsWindow) ||
    Number(raw.rebuilds) ||
    0;
  const rebuildsSession = Number(raw.rebuildsSession) || rebuildsWindow;
  const windowSec = Math.max(0.001, (windowMs || 10000) / 1000);
  const ratePerSec =
    Number(raw.ratePerSec) ||
    Number((rebuildsWindow / windowSec).toFixed(2));
  const share =
    Number(raw.share) ||
    (totalWindow > 0 ? Number(((rebuildsWindow / totalWindow) * 100).toFixed(1)) : 0);
  return {
    id,
    name,
    route,
    keyLabel,
    rebuildsSession,
    rebuildsWindow,
    ratePerSec,
    share,
    lastSeenMs: Number(raw.lastSeenMs) || 0,
    isFramework: Boolean(raw.isFramework),
    duringJank: Boolean(raw.duringJank) || duringJank,
  };
}

async function pollHotWidgets(session: Session) {
  if (session.mode !== "live" || !session.isolateId) return;

  // Freeze: stop polling entirely — UI keeps the last snapshot
  if (session.hotWidgetsFrozen) {
    return;
  }
  // Record: keep the cleared snapshot for a short quiet window
  if (Date.now() < session.recordQuietUntil) {
    return;
  }

  if (!session.extensionMethods.includes("ext.pulseflow.getHotWidgets")) {
    if (session.widgetProbeAvailable !== false) {
      session.widgetProbeAvailable = false;
      send(session.client, {
        type: "hotWidgets",
        available: false,
        windowMs: 0,
        totalRebuildsWindow: 0,
        totalRebuildsSession: 0,
        widgets: [],
        screens: [],
        message:
          "Hot widgets unavailable — add pulseflow_extension.dart to the app",
      });
    }
    return;
  }

  try {
    const res = await rpc(session, "ext.pulseflow.getHotWidgets", {
      isolateId: session.isolateId,
      limit: "40",
    });
    const data = parseExtensionJson(res);
    if (!data) return;
    const windowMs = Number(data.windowMs) || 10000;
    const duringJank = session.lastFrameMs > FRAME_BUDGET_MS;
    const rawWidgets = (Array.isArray(data.widgets) ? data.widgets : []) as Array<
      Record<string, unknown>
    >;
    const totalWindow =
      Number(data.totalRebuildsWindow) ||
      Number(data.totalRebuilds) ||
      rawWidgets.reduce(
        (a, w) => a + (Number(w.rebuildsWindow) || Number(w.rebuilds) || 0),
        0,
      );
    const totalSession =
      Number(data.totalRebuildsSession) ||
      rawWidgets.reduce(
        (a, w) => a + (Number(w.rebuildsSession) || Number(w.rebuilds) || 0),
        0,
      );
    const widgets = rawWidgets.map((w) =>
      mapWidgetStat(w, totalWindow, windowMs, duringJank),
    );
    const windowSec = windowMs / 1000;
    let screens: ScreenRebuildStat[] = [];
    if (Array.isArray(data.screens)) {
      screens = (data.screens as Array<Record<string, unknown>>).map((s) => {
        const topRaw = (Array.isArray(s.topWidgets) ? s.topWidgets : []) as Array<
          Record<string, unknown>
        >;
        const topWidgets = topRaw.map((w) =>
          mapWidgetStat(w, totalWindow, windowMs, duringJank),
        );
        const rebuildsWindow =
          Number(s.rebuildsWindow) ||
          topWidgets.reduce((a, w) => a + w.rebuildsWindow, 0);
        return {
          route: String(s.route ?? "(unnamed)"),
          rebuildsWindow,
          ratePerSec:
            Number(s.ratePerSec) ||
            Number((rebuildsWindow / windowSec).toFixed(2)),
          share:
            Number(s.share) ||
            (totalWindow > 0
              ? Number(((rebuildsWindow / totalWindow) * 100).toFixed(1))
              : 0),
          topWidgets,
        };
      });
    } else {
      const byRoute = new Map<string, WidgetRebuildStat[]>();
      for (const w of widgets) {
        const list = byRoute.get(w.route) ?? [];
        list.push(w);
        byRoute.set(w.route, list);
      }
      screens = [...byRoute.entries()]
        .map(([route, list]) => {
          const rebuildsWindow = list.reduce((a, w) => a + w.rebuildsWindow, 0);
          return {
            route,
            rebuildsWindow,
            ratePerSec: Number((rebuildsWindow / windowSec).toFixed(2)),
            share:
              totalWindow > 0
                ? Number(((rebuildsWindow / totalWindow) * 100).toFixed(1))
                : 0,
            topWidgets: list.slice(0, 5),
          };
        })
        .sort((a, b) => b.rebuildsWindow - a.rebuildsWindow);
    }

    session.widgetProbeAvailable = true;
    const payload: HotWidgetsPayload = {
      type: "hotWidgets",
      available: true,
      windowMs,
      totalRebuildsWindow: totalWindow,
      totalRebuildsSession: totalSession,
      totalRebuilds: totalWindow,
      currentRoute:
        data.currentRoute != null ? String(data.currentRoute) : undefined,
      widgets,
      screens,
      frozen: Boolean(data.frozen) || session.hotWidgetsFrozen,
      duringJank,
      message:
        totalWindow === 0 ? "Sampling rebuilds — interact with the UI" : undefined,
    };
    session.lastHotWidgetsPayload = payload;
    send(session.client, payload);
  } catch (err) {
    send(session.client, {
      type: "hotWidgets",
      available: false,
      windowMs: 0,
      totalRebuildsWindow: 0,
      totalRebuildsSession: 0,
      widgets: [],
      screens: [],
      message: err instanceof Error ? err.message : "getHotWidgets failed",
    });
  }
}

function sendFrozenAck(session: Session, message: string) {
  const base = session.lastHotWidgetsPayload ?? {
    type: "hotWidgets" as const,
    available: true,
    windowMs: 10000,
    totalRebuildsWindow: 0,
    totalRebuildsSession: 0,
    totalRebuilds: 0,
    widgets: [] as WidgetRebuildStat[],
    screens: [] as ScreenRebuildStat[],
  };
  const payload: HotWidgetsPayload = {
    ...base,
    frozen: true,
    message,
  };
  session.lastHotWidgetsPayload = payload;
  send(session.client, payload);
}

function sendClearedHotWidgets(session: Session, message: string) {
  const payload: HotWidgetsPayload = {
    type: "hotWidgets",
    available: true,
    windowMs: 10000,
    totalRebuildsWindow: 0,
    totalRebuildsSession: 0,
    totalRebuilds: 0,
    widgets: [],
    screens: [],
    frozen: false,
    message,
  };
  session.lastHotWidgetsPayload = payload;
  send(session.client, payload);
}

async function runHotWidgetsControl(
  session: Session,
  action: "freeze" | "unfreeze" | "reset",
) {
  if (session.mode === "mock") {
    if (action === "freeze") {
      session.hotWidgetsFrozen = true;
      sendFrozenAck(session, "Frozen — demo ranks held still");
      send(session.client, {
        type: "status",
        status: "connected",
        mode: "mock",
        message: "Widget probe frozen",
      });
      return;
    }
    if (action === "unfreeze") {
      session.hotWidgetsFrozen = false;
      emitMockHotWidgets(session);
      send(session.client, {
        type: "status",
        status: "connected",
        mode: "mock",
        message: "Widget probe unfrozen",
      });
      return;
    }
    // Record — clear session and hold empty for 2.5s so UI visibly resets
    session.hotWidgetsFrozen = false;
    session.mockSessionRebuilds.clear();
    session.lastHotWidgetsPayload = undefined;
    session.recordQuietUntil = Date.now() + 2500;
    sendClearedHotWidgets(session, "Recording — counters cleared, waiting for new samples…");
    send(session.client, {
      type: "status",
      status: "connected",
      mode: "mock",
      message: "Recording — session cleared",
    });
    return;
  }

  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, {
      type: "error",
      message: "Connect to an app (or demo mode) before Record / Freeze",
    });
    return;
  }

  try {
    if (action === "reset") {
      session.hotWidgetsFrozen = false;
      session.recordQuietUntil = Date.now() + 2500;
      sendClearedHotWidgets(session, "Recording — counters cleared, waiting for new samples…");
      if (session.extensionMethods.includes("ext.pulseflow.resetWidgetProbe")) {
        await rpc(session, "ext.pulseflow.resetWidgetProbe", {
          isolateId: session.isolateId,
        });
      } else if (session.extensionMethods.includes("ext.pulseflow.stopWidgetProbe")) {
        // Older stub: stop+start approximates a session reset
        try {
          await rpc(session, "ext.pulseflow.stopWidgetProbe", {
            isolateId: session.isolateId,
          });
        } catch {
          /* ignore */
        }
        if (session.extensionMethods.includes("ext.pulseflow.startWidgetProbe")) {
          await rpc(session, "ext.pulseflow.startWidgetProbe", {
            isolateId: session.isolateId,
          });
        }
      }
      // Do NOT poll immediately — quiet window keeps the cleared UI visible
      send(session.client, {
        type: "status",
        status: "connected",
        mode: "live",
        message: "Recording — session cleared",
      });
      return;
    }

    const frozen = action === "freeze";
    session.hotWidgetsFrozen = frozen;
    if (session.extensionMethods.includes("ext.pulseflow.setWidgetProbeFrozen")) {
      await rpc(session, "ext.pulseflow.setWidgetProbeFrozen", {
        isolateId: session.isolateId,
        frozen: String(frozen),
      });
    }
    if (frozen) {
      sendFrozenAck(session, "Frozen — ranks held still");
    } else {
      await pollHotWidgets(session);
    }
    send(session.client, {
      type: "status",
      status: "connected",
      mode: "live",
      message: frozen ? "Widget probe frozen" : "Widget probe unfrozen",
    });
  } catch (err) {
    send(session.client, {
      type: "error",
      message: err instanceof Error ? err.message : "Widget probe control failed",
    });
  }
}

async function pollMemory(session: Session): Promise<{ heapMb: number; externalMb: number }> {
  if (!session.isolateId) return { heapMb: 0, externalMb: 0 };
  try {
    const usage = (await rpc(session, "getMemoryUsage", {
      isolateId: session.isolateId,
    })) as {
      result?: {
        heapUsage?: number;
        heapCapacity?: number;
        externalUsage?: number;
      };
    };
    const heap = usage.result?.heapUsage ?? usage.result?.heapCapacity ?? 0;
    const external = usage.result?.externalUsage ?? 0;
    return {
      heapMb: heap / (1024 * 1024),
      externalMb: external / (1024 * 1024),
    };
  } catch {
    try {
      const profile = (await rpc(session, "getAllocationProfile", {
        isolateId: session.isolateId,
      })) as {
        result?: { memoryUsage?: { heapUsage?: number; externalUsage?: number } };
      };
      const heap = profile.result?.memoryUsage?.heapUsage ?? 0;
      const external = profile.result?.memoryUsage?.externalUsage ?? 0;
      return {
        heapMb: heap / (1024 * 1024),
        externalMb: external / (1024 * 1024),
      };
    } catch {
      return { heapMb: 0, externalMb: 0 };
    }
  }
}

async function pollHttpProfile(session: Session) {
  if (!session.isolateId || session.httpProfileSupported === false) return;
  try {
    const res = (await rpc(session, "getHttpProfile", {
      isolateId: session.isolateId,
    })) as {
      result?: {
        requests?: Array<{
          id?: number | string;
          method?: string;
          uri?: string;
          startTime?: number;
          endTime?: number;
          requestBodyBytes?: number;
          responseBodyBytes?: number;
          response?: { statusCode?: number };
        }>;
      };
    };
    session.httpProfileSupported = true;
    session.caps.httpProfile = true;
    const requests = res.result?.requests ?? [];
    const batch: Array<{
      id: string;
      t: number;
      method: string;
      uri: string;
      latencyMs: number;
      requestBytes: number;
      responseBytes: number;
      status?: number;
      startMs?: number;
      endMs?: number;
    }> = [];
    for (const r of requests) {
      const id = String(r.id ?? "");
      if (!id || session.seenHttpIds.has(id)) continue;
      session.seenHttpIds.add(id);
      const start = r.startTime ?? 0;
      const end = r.endTime ?? start;
      const latencyMs = Math.max(0, (end - start) / 1000);
      batch.push({
        id,
        t: Date.now(),
        method: r.method ?? "GET",
        uri: r.uri ?? "/",
        latencyMs: Number(latencyMs.toFixed(1)),
        requestBytes: r.requestBodyBytes ?? 0,
        responseBytes: r.responseBodyBytes ?? 0,
        status: r.response?.statusCode,
        startMs: start / 1000,
        endMs: end / 1000,
      });
    }
    // Cap seen set growth
    if (session.seenHttpIds.size > 2000) {
      session.seenHttpIds = new Set([...session.seenHttpIds].slice(-1000));
    }
    if (batch.length) {
      send(session.client, {
        type: "network",
        available: true,
        requests: batch.slice(-40),
        request: batch[batch.length - 1],
      });
    } else if (requests.length === 0 && session.seenHttpIds.size === 0) {
      send(session.client, {
        type: "network",
        available: true,
        message: "HTTP profile available — waiting for requests",
      });
    }

    if (session.caps.socketProfile) {
      try {
        const sock = (await rpc(session, "ext.dart.io.getSocketProfile", {
          isolateId: session.isolateId,
        })) as {
          result?: {
            sockets?: Array<{
              id?: string | number;
              remoteAddress?: string;
              remotePort?: number;
              readBytes?: number;
              writeBytes?: number;
            }>;
          };
        };
        const sockets = (sock.result?.sockets ?? []).slice(-20).map((s) => ({
          id: String(s.id ?? randomUUID()),
          t: Date.now(),
          address: s.remoteAddress ?? "unknown",
          port: s.remotePort,
          readBytes: s.readBytes ?? 0,
          writeBytes: s.writeBytes ?? 0,
        }));
        if (sockets.length) {
          send(session.client, {
            type: "network",
            available: true,
            sockets,
          });
        }
      } catch {
        /* optional */
      }
    }
  } catch {
    if (session.httpProfileSupported === null) {
      session.httpProfileSupported = false;
      session.caps.httpProfile = false;
      send(session.client, {
        type: "network",
        available: false,
        message:
          "HTTP profile not exposed by this VM/DDS — network panel will stay empty until available",
      });
    }
  }
}

async function tryRpc(session: Session, method: string, params?: Record<string, unknown>) {
  try {
    await rpc(session, method, params);
    return true;
  } catch {
    return false;
  }
}

async function probeCapabilities(session: Session) {
  const caps: CapabilityMap = { ...DEFAULT_CAPS };
  if (!session.isolateId) {
    session.caps = caps;
    send(session.client, { type: "capabilities", caps, message: "No isolate" });
    return;
  }

  const isolateId = session.isolateId;

  // Enable sampling before CPU probes. There is no getFlag RPC — only
  // getFlagList / setFlag — and a cold parallel probe can time out and
  // falsely mark getCpuSamples unavailable.
  await ensureProfiler(session);

  const probe = async (
    method: string,
    params: Record<string, unknown>,
    opts?: { retryTimeout?: boolean },
  ) => {
    const once = async () => {
      try {
        await rpc(session, method, params, 2500);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unknown method|not found|MethodNotFound/i.test(msg)) {
          return false;
        }
        if (/timeout/i.test(msg)) return false;
        // Other errors (bad args, profiler previously disabled) still mean
        // the method exists on this VM.
        return true;
      }
    };
    const first = await once();
    if (first || !opts?.retryTimeout) return first;
    await new Promise((r) => setTimeout(r, 200));
    return once();
  };

  const profilerFlag = await profilerFlagAvailable(session);

  const [
    cpuSamples,
    clearCpuSamples,
    allocationProfile,
    retainingPath,
    instances,
    perfettoTimeline,
    perfettoCpuSamples,
    vmTimelineMicros,
    socketProfile,
  ] = await Promise.all([
    probe(
      "getCpuSamples",
      {
        isolateId,
        timeOriginMicros: 0,
        timeExtentMicros: 1,
      },
      { retryTimeout: true },
    ),
    probe("clearCpuSamples", { isolateId }),
    probe("getAllocationProfile", { isolateId }),
    probe("getRetainingPath", {
      isolateId,
      targetId: "objects/0",
      limit: 1,
    }),
    probe("getInstances", {
      isolateId,
      objectId: "classes/0",
      limit: 1,
    }),
    probe("getPerfettoVMTimeline", {
      timeOriginMicros: 0,
      timeExtentMicros: 1,
    }),
    probe("getPerfettoCpuSamples", {
      isolateId,
      timeOriginMicros: 0,
      timeExtentMicros: 1,
    }),
    probe("getVMTimelineMicros", {}),
    probe("ext.dart.io.getSocketProfile", { isolateId }),
  ]);

  caps.cpuSamples = cpuSamples;
  caps.clearCpuSamples = clearCpuSamples;
  caps.allocationProfile = allocationProfile;
  caps.retainingPath = retainingPath;
  caps.instances = instances;
  caps.perfettoTimeline = perfettoTimeline;
  caps.perfettoCpuSamples = perfettoCpuSamples;
  caps.vmTimelineMicros = vmTimelineMicros;
  caps.profilerFlag = profilerFlag;
  caps.httpProfile = session.httpProfileSupported !== false;
  caps.socketProfile = socketProfile;
  caps.pulseExtension = session.extensionMethods.some((m) => m.startsWith("ext.pulseflow."));
  caps.scenarios = session.extensionMethods.includes("ext.pulseflow.listScenarios");
  caps.widgetProbe = session.extensionMethods.includes("ext.pulseflow.getHotWidgets");

  session.caps = caps;
  send(session.client, {
    type: "capabilities",
    caps,
    message: "VM/DDS capability probe complete",
  });
}

async function profilerFlagAvailable(session: Session): Promise<boolean> {
  try {
    const res = (await rpc(session, "getFlagList", {}, 2500)) as {
      result?: { flags?: Array<{ name?: string }> };
    };
    return !!res.result?.flags?.some((f) => f.name === "profiler");
  } catch {
    return false;
  }
}

async function ensureProfiler(session: Session) {
  try {
    const res = (await rpc(session, "getFlagList", {}, 2500)) as {
      result?: { flags?: Array<{ name?: string; valueAsString?: string }> };
    };
    const profiler = res.result?.flags?.find((f) => f.name === "profiler");
    if (profiler?.valueAsString === "true") return;
  } catch {
    // Fall through and still try setFlag.
  }
  try {
    await rpc(session, "setFlag", { name: "profiler", value: "true" });
  } catch {
    /* best effort */
  }
}

async function finishCpuRecord(session: Session) {
  if (session.cpuRecordTimer) {
    clearTimeout(session.cpuRecordTimer);
    session.cpuRecordTimer = undefined;
  }
  const startedAt = session.cpuRecordStartedAt ?? Date.now();
  const durationMs = Math.max(100, Date.now() - startedAt);
  session.cpuRecording = false;

  if (session.mode === "mock") {
    const profile = mockCpuProfile(durationMs);
    session.cpuProfileCache = profile;
    send(session.client, {
      type: "cpuProfile",
      available: true,
      recording: false,
      profile,
      message: "Demo CPU profile ready",
    });
    return;
  }

  if (!session.isolateId || !session.caps.cpuSamples) {
    send(session.client, {
      type: "cpuProfile",
      available: false,
      recording: false,
      message:
        "CPU samples unavailable — run in profile mode and ensure the VM profiler is enabled",
    });
    return;
  }

  try {
    let origin = session.cpuRecordOriginMicros ?? 0;
    let extent = durationMs * 1000;
    if (session.caps.vmTimelineMicros) {
      const now = (await rpc(session, "getVMTimelineMicros")) as {
        result?: { timestamp?: number };
      };
      const end = now.result?.timestamp ?? origin + extent;
      if (!origin) origin = Math.max(0, end - extent);
      extent = Math.max(1, end - origin);
    }
    const res = (await rpc(session, "getCpuSamples", {
      isolateId: session.isolateId,
      timeOriginMicros: origin,
      timeExtentMicros: extent,
    })) as { result?: Record<string, unknown> };
    const profile = transformCpuSamples(
      (res.result ?? {}) as Parameters<typeof transformCpuSamples>[0],
      durationMs,
    );
    session.cpuProfileCache = profile;
    send(session.client, {
      type: "cpuProfile",
      available: true,
      recording: false,
      profile,
      message: `CPU profile: ${profile.sampleCount} samples over ${durationMs} ms`,
    });
  } catch (err) {
    send(session.client, {
      type: "cpuProfile",
      available: false,
      recording: false,
      message:
        err instanceof Error
          ? err.message
          : "getCpuSamples failed — try profile mode with profiler enabled",
    });
  }
}

async function handleCpuRecord(
  session: Session,
  action: "start" | "stop",
  durationMs = 5000,
) {
  const clamped = [3000, 5000, 10000].includes(durationMs) ? durationMs : 5000;

  if (action === "stop") {
    if (!session.cpuRecording) {
      send(session.client, {
        type: "cpuProfile",
        available: Boolean(session.cpuProfileCache),
        recording: false,
        profile: session.cpuProfileCache,
        message: "No CPU recording in progress",
      });
      return;
    }
    await finishCpuRecord(session);
    return;
  }

  if (session.cpuRecording) {
    send(session.client, {
      type: "error",
      message: "CPU recording already in progress",
    });
    return;
  }

  if (session.mode === "idle") {
    send(session.client, {
      type: "error",
      message: "Connect or start demo mode before recording CPU",
    });
    return;
  }

  if (session.mode === "live" && !session.caps.cpuSamples) {
    send(session.client, {
      type: "cpuProfile",
      available: false,
      recording: false,
      message:
        "getCpuSamples not available on this VM — use Flutter profile mode with the CPU profiler enabled",
    });
    return;
  }

  session.cpuRecording = true;
  session.cpuRecordStartedAt = Date.now();
  const waitMs = session.mode === "mock" ? Math.min(800, clamped) : clamped;

  if (session.mode === "live" && session.isolateId) {
    await ensureProfiler(session);
    if (session.caps.clearCpuSamples) {
      await tryRpc(session, "clearCpuSamples", { isolateId: session.isolateId });
    }
    if (session.caps.vmTimelineMicros) {
      try {
        const now = (await rpc(session, "getVMTimelineMicros")) as {
          result?: { timestamp?: number };
        };
        session.cpuRecordOriginMicros = now.result?.timestamp ?? 0;
      } catch {
        session.cpuRecordOriginMicros = 0;
      }
    } else {
      session.cpuRecordOriginMicros = 0;
    }
  }

  send(session.client, {
    type: "cpuProfile",
    available: true,
    recording: true,
    message: `Recording CPU for ${clamped} ms…`,
  });

  session.cpuRecordTimer = setTimeout(() => {
    void finishCpuRecord(session);
  }, waitMs);
}

async function handleScenario(
  session: Session,
  action: "list" | "run" | "stop",
  id?: string,
  params?: Record<string, unknown>,
) {
  if (session.mode === "mock") {
    if (action === "list") {
      send(session.client, {
        type: "scenarioStatus",
        scenarios: MOCK_SCENARIOS,
        running: session.scenarioRunning,
        message: "Demo scenarios",
      });
      return;
    }
    if (action === "stop") {
      if (session.scenarioTimer) clearTimeout(session.scenarioTimer);
      session.scenarioTimer = undefined;
      const stopped = session.scenarioRunning;
      session.scenarioRunning = null;
      send(session.client, {
        type: "scenarioStatus",
        scenarios: MOCK_SCENARIOS,
        running: null,
        result: { id: stopped ?? "unknown", ok: true, stopped: true },
        message: "Demo scenario stopped",
      });
      return;
    }
    const scenarioId = id ?? "scrollStorm";
    session.scenarioRunning = scenarioId;
    send(session.client, {
      type: "scenarioStatus",
      scenarios: MOCK_SCENARIOS,
      running: scenarioId,
      message: `Demo scenario ${scenarioId} running`,
    });
    // Spike metrics for ~3s
    let bursts = 0;
    const spike = setInterval(() => {
      bursts += 1;
      emitMockMetrics(session);
      if (bursts >= 12) clearInterval(spike);
    }, 250);
    session.scenarioTimer = setTimeout(() => {
      session.scenarioRunning = null;
      send(session.client, {
        type: "scenarioStatus",
        scenarios: MOCK_SCENARIOS,
        running: null,
        result: {
          id: scenarioId,
          ok: true,
          durationMs: 3000,
          stubbed: scenarioId === "networkBurst",
          message: "Demo scenario finished",
        },
      });
    }, 3000);
    return;
  }

  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, {
      type: "error",
      message: "Connect to a Flutter app (with PulseFlow stub) to run scenarios",
    });
    return;
  }

  if (action === "list") {
    if (!session.extensionMethods.includes("ext.pulseflow.listScenarios")) {
      send(session.client, {
        type: "scenarioStatus",
        scenarios: [],
        running: null,
        message:
          "Scenario API missing — update examples/pulseflow_extension.dart and hot-restart",
      });
      return;
    }
    try {
      const res = await rpc(session, "ext.pulseflow.listScenarios", {
        isolateId: session.isolateId,
      });
      const json = parseExtensionJson(res);
      const scenarios = (json?.scenarios as ScenarioInfo[]) ?? MOCK_SCENARIOS;
      send(session.client, {
        type: "scenarioStatus",
        scenarios,
        running: session.scenarioRunning,
        message: "Scenarios loaded",
      });
    } catch (err) {
      send(session.client, {
        type: "error",
        message: err instanceof Error ? err.message : "listScenarios failed",
      });
    }
    return;
  }

  if (action === "stop") {
    try {
      await rpc(session, "ext.pulseflow.stopScenario", {
        isolateId: session.isolateId,
      });
      const stopped = session.scenarioRunning;
      session.scenarioRunning = null;
      send(session.client, {
        type: "scenarioStatus",
        running: null,
        result: { id: stopped ?? "unknown", ok: true, stopped: true },
        message: "Scenario stopped",
      });
    } catch (err) {
      send(session.client, {
        type: "error",
        message: err instanceof Error ? err.message : "stopScenario failed",
      });
    }
    return;
  }

  if (!id) {
    send(session.client, { type: "error", message: "Scenario id required" });
    return;
  }
  if (!session.extensionMethods.includes("ext.pulseflow.runScenario")) {
    send(session.client, {
      type: "scenarioStatus",
      running: null,
      message: "ext.pulseflow.runScenario not registered",
    });
    return;
  }

  try {
    session.scenarioRunning = id;
    send(session.client, {
      type: "scenarioStatus",
      running: id,
      message: `Running scenario ${id}`,
    });
    const res = await rpc(
      session,
      "ext.pulseflow.runScenario",
      {
        isolateId: session.isolateId,
        id,
        ...(params ?? {}),
        // Extension params are strings
        params: JSON.stringify(params ?? {}),
      },
      60000,
    );
    const json = parseExtensionJson(res) ?? {};
    session.scenarioRunning = null;
    send(session.client, {
      type: "scenarioStatus",
      running: null,
      result: {
        id,
        ok: Boolean(json.ok ?? true),
        stubbed: Boolean(json.stubbed),
        reason: typeof json.reason === "string" ? json.reason : undefined,
        durationMs: typeof json.durationMs === "number" ? json.durationMs : undefined,
        message: typeof json.message === "string" ? json.message : undefined,
      },
      message: json.ok === false ? String(json.reason ?? "Scenario failed") : `Scenario ${id} finished`,
    });
  } catch (err) {
    session.scenarioRunning = null;
    send(session.client, {
      type: "error",
      message: err instanceof Error ? err.message : "runScenario failed",
    });
  }
}

function mapAllocationClasses(raw: unknown): AllocationClassStat[] {
  const result = (raw as { result?: { members?: Array<Record<string, unknown>> } })?.result;
  const members = result?.members ?? [];
  const classes: AllocationClassStat[] = [];
  for (const m of members) {
    const cls = m.class_ as { name?: string; id?: string } | undefined;
    const name = cls?.name ?? (typeof m.name === "string" ? m.name : undefined);
    if (!name) continue;
    const instances = Number(m.instancesCurrent ?? m.instances ?? 0);
    const bytes = Number(m.bytesCurrent ?? m.bytes ?? 0);
    if (instances <= 0 && bytes <= 0) continue;
    classes.push({
      className: name,
      instances,
      bytes,
      classId: cls?.id,
    });
  }
  return classes.sort((a, b) => b.bytes - a.bytes).slice(0, 40);
}

async function handleMemorySnapshot(
  session: Session,
  action: "capture" | "diff" | "retainingPath",
  snapshotId?: string,
  classId?: string,
  objectId?: string,
) {
  if (session.mode === "mock") {
    if (action === "capture") {
      const n = session.memorySnapshots.length;
      const snap: MemorySnapshot = {
        id: randomUUID(),
        t: Date.now(),
        heapMb: 48 + n * 12,
        externalMb: 10 + n * 2,
        classes: [
          {
            className: "Invoice",
            instances: 120 + n * 80,
            bytes: (120 + n * 80) * 256,
          },
          {
            className: "_Uint8ArrayView",
            instances: 40 + n * 20,
            bytes: (32 + n * 16) * 1024 * 1024,
          },
          {
            className: "Image",
            instances: 18 + n * 4,
            bytes: (6 + n * 2) * 1024 * 1024,
          },
          {
            className: "String",
            instances: 4000 + n * 500,
            bytes: (2 + n) * 1024 * 1024,
          },
        ],
      };
      session.memorySnapshots.push(snap);
      if (session.memorySnapshots.length > 4) session.memorySnapshots.shift();
      send(session.client, {
        type: "memoryProfile",
        available: true,
        snapshot: snap,
        message: `Demo snapshot ${session.memorySnapshots.length} captured`,
      });
      return;
    }
    if (action === "diff") {
      if (session.memorySnapshots.length < 2) {
        send(session.client, {
          type: "memoryProfile",
          available: true,
          message: "Capture two snapshots to diff",
        });
        return;
      }
      const from = session.memorySnapshots[session.memorySnapshots.length - 2]!;
      const to = session.memorySnapshots[session.memorySnapshots.length - 1]!;
      const fromMap = new Map(from.classes.map((c) => [c.className, c]));
      const grew = to.classes
        .map((c) => {
          const prev = fromMap.get(c.className);
          return {
            className: c.className,
            classId: c.classId,
            instancesDelta: c.instances - (prev?.instances ?? 0),
            bytesDelta: c.bytes - (prev?.bytes ?? 0),
          };
        })
        .filter((d) => d.bytesDelta > 0 || d.instancesDelta > 0)
        .sort((a, b) => b.bytesDelta - a.bytesDelta);
      send(session.client, {
        type: "memoryProfile",
        available: true,
        diff: { fromId: from.id, toId: to.id, grew },
        message: "Demo memory diff",
      });
      return;
    }
    send(session.client, {
      type: "memoryProfile",
      available: true,
      retainingPath: [
        { label: "InvoiceListState", kind: "Instance" },
        { label: "invoices", kind: "Field" },
        { label: "Invoice", kind: "Instance" },
      ],
      message: "Demo retaining path",
    });
    return;
  }

  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, {
      type: "error",
      message: "Connect before capturing memory snapshots",
    });
    return;
  }

  if (action === "capture") {
    if (!session.caps.allocationProfile) {
      send(session.client, {
        type: "memoryProfile",
        available: false,
        message: "getAllocationProfile not available on this VM",
      });
      return;
    }
    try {
      const res = await rpc(session, "getAllocationProfile", {
        isolateId: session.isolateId,
      });
      const mem = await pollMemory(session);
      const snap: MemorySnapshot = {
        id: randomUUID(),
        t: Date.now(),
        heapMb: mem.heapMb,
        externalMb: mem.externalMb,
        classes: mapAllocationClasses(res),
      };
      session.memorySnapshots.push(snap);
      if (session.memorySnapshots.length > 4) session.memorySnapshots.shift();
      send(session.client, {
        type: "memoryProfile",
        available: true,
        snapshot: snap,
        message: `Snapshot captured (${snap.classes.length} classes)`,
      });
    } catch (err) {
      send(session.client, {
        type: "memoryProfile",
        available: false,
        message: err instanceof Error ? err.message : "Allocation profile failed",
      });
    }
    return;
  }

  if (action === "diff") {
    const from = session.memorySnapshots[session.memorySnapshots.length - 2];
    let to = session.memorySnapshots[session.memorySnapshots.length - 1];
    if (snapshotId) {
      to = session.memorySnapshots.find((s) => s.id === snapshotId) ?? to;
    }
    if (!from || !to) {
      send(session.client, {
        type: "memoryProfile",
        available: true,
        message: "Need two snapshots to diff — capture again",
      });
      return;
    }
    const fromMap = new Map(from.classes.map((c) => [c.className, c]));
    const grew = to.classes
      .map((c) => {
        const prev = fromMap.get(c.className);
        return {
          className: c.className,
          classId: c.classId,
          instancesDelta: c.instances - (prev?.instances ?? 0),
          bytesDelta: c.bytes - (prev?.bytes ?? 0),
        };
      })
      .filter((d) => d.bytesDelta > 0)
      .sort((a, b) => b.bytesDelta - a.bytesDelta)
      .slice(0, 30);
    send(session.client, {
      type: "memoryProfile",
      available: true,
      diff: { fromId: from.id, toId: to.id, grew },
      message: `${grew.length} growing classes`,
    });
    return;
  }

  // retainingPath
  if (!session.caps.retainingPath) {
    send(session.client, {
      type: "memoryProfile",
      available: false,
      message: "getRetainingPath not available on this VM",
    });
    return;
  }
  try {
    let targetId = objectId;
    if (!targetId && classId && session.caps.instances) {
      const inst = (await rpc(session, "getInstances", {
        isolateId: session.isolateId,
        objectId: classId,
        limit: 1,
      })) as { result?: { instances?: Array<{ id?: string }> } };
      targetId = inst.result?.instances?.[0]?.id;
    }
    if (!targetId) {
      send(session.client, {
        type: "memoryProfile",
        available: true,
        message: "Pick a class/object id for retaining path",
      });
      return;
    }
    const pathRes = (await rpc(session, "getRetainingPath", {
      isolateId: session.isolateId,
      targetId,
      limit: 20,
    })) as {
      result?: {
        elements?: Array<{ value?: { className?: string; name?: string }; type?: string }>;
      };
    };
    const retainingPath = (pathRes.result?.elements ?? []).map((el) => ({
      label: el.value?.className ?? el.value?.name ?? el.type ?? "object",
      kind: el.type,
    }));
    send(session.client, {
      type: "memoryProfile",
      available: true,
      retainingPath,
      message: retainingPath.length ? "Retaining path" : "Empty retaining path",
    });
  } catch (err) {
    send(session.client, {
      type: "memoryProfile",
      available: false,
      message: err instanceof Error ? err.message : "Retaining path failed",
    });
  }
}

function pushMarker(
  session: Session,
  kind: "jank" | "gc" | "shader" | "other",
  label: string,
) {
  session.timelineMarkers.push({
    id: randomUUID(),
    t: Date.now(),
    kind,
    label,
  });
  if (session.timelineMarkers.length > 80) {
    session.timelineMarkers = session.timelineMarkers.slice(-60);
  }
}

async function handleTimelineExport(session: Session, durationMs = 5000) {
  if (session.mode === "mock") {
    const fake = Buffer.from(
      JSON.stringify({
        demo: true,
        markers: session.timelineMarkers.slice(-20),
        note: "Demo Perfetto placeholder — connect a live VM for real traces",
      }),
    ).toString("base64");
    send(session.client, {
      type: "timelineExport",
      available: true,
      format: "json",
      base64: fake,
      fileName: `pulseflow-demo-timeline-${Date.now()}.json`,
      markers: session.timelineMarkers.slice(-30),
      message: "Demo timeline export (JSON placeholder)",
    });
    return;
  }

  if (session.mode !== "live") {
    send(session.client, {
      type: "error",
      message: "Connect before exporting timeline",
    });
    return;
  }

  const extent = Math.max(1000, durationMs) * 1000;
  try {
    if (session.caps.perfettoTimeline) {
      let origin = 0;
      if (session.caps.vmTimelineMicros) {
        const now = (await rpc(session, "getVMTimelineMicros")) as {
          result?: { timestamp?: number };
        };
        const end = now.result?.timestamp ?? extent;
        origin = Math.max(0, end - extent);
      }
      const res = (await rpc(session, "getPerfettoVMTimeline", {
        timeOriginMicros: origin,
        timeExtentMicros: extent,
      })) as { result?: { trace?: string } };
      const b64 = res.result?.trace;
      if (b64) {
        send(session.client, {
          type: "timelineExport",
          available: true,
          format: "perfetto",
          base64: b64,
          fileName: `pulseflow-perfetto-${Date.now()}.pftrace`,
          markers: session.timelineMarkers.slice(-40),
          message: "Perfetto timeline ready",
        });
        return;
      }
    }

    // Fallback: VM timeline JSON
    const tl = (await rpc(session, "getVMTimeline", {
      timeOriginMicros: 0,
      timeExtentMicros: extent,
    })) as { result?: unknown };
    const b64 = Buffer.from(JSON.stringify(tl.result ?? {})).toString("base64");
    send(session.client, {
      type: "timelineExport",
      available: true,
      format: "json",
      base64: b64,
      fileName: `pulseflow-timeline-${Date.now()}.json`,
      markers: session.timelineMarkers.slice(-40),
      message: "Perfetto RPC unavailable — exported VM timeline JSON instead",
    });
  } catch (err) {
    send(session.client, {
      type: "timelineExport",
      available: false,
      format: "json",
      markers: session.timelineMarkers.slice(-20),
      message: err instanceof Error ? err.message : "Timeline export failed",
    });
  }
}

async function handleNetworkControl(
  session: Session,
  action: "refresh" | "clear" | "enable",
) {
  if (session.mode === "mock") {
    if (action === "clear") {
      session.seenHttpIds.clear();
      send(session.client, {
        type: "network",
        available: true,
        requests: [],
        message: "Mock network buffer cleared",
      });
      return;
    }
    const demo = Array.from({ length: 8 }, (_, i) => ({
      id: randomUUID(),
      t: Date.now() - (8 - i) * 400,
      method: i % 3 === 0 ? "POST" : "GET",
      uri: i % 2 === 0 ? "/api/invoices" : `/api/items/${i}`,
      latencyMs: Number((80 + Math.random() * 600).toFixed(1)),
      requestBytes: 400 + i * 120,
      responseBytes: 1200 + i * 300,
      status: i === 5 ? 500 : 200,
      startMs: i * 100,
      endMs: i * 100 + 80 + Math.random() * 600,
    }));
    send(session.client, {
      type: "network",
      available: true,
      requests: demo,
      request: demo[demo.length - 1],
      message: "Mock network refresh",
    });
    return;
  }

  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, { type: "error", message: "Connect before network control" });
    return;
  }

  if (action === "clear") {
    session.seenHttpIds.clear();
    await tryRpc(session, "clearHttpProfile", { isolateId: session.isolateId });
    send(session.client, {
      type: "network",
      available: session.httpProfileSupported !== false,
      requests: [],
      message: "HTTP profile cleared",
    });
    return;
  }

  if (action === "enable") {
    await tryRpc(session, "ext.dart.io.httpEnableTimelineLogging", {
      isolateId: session.isolateId,
      enabled: "true",
    });
    await tryRpc(session, "ext.dart.io.getHttpEnableTimelineLogging", {
      isolateId: session.isolateId,
    });
  }

  await pollHttpProfile(session);
}

function handleVmEvent(session: Session, event: Record<string, unknown>) {
  const kind = String(event.kind ?? "");
  const t = Date.now();

  if (kind === "GC" || kind === "GarbageCollection") {
    pushMarker(session, "gc", String(event.reason ?? event.type ?? "gc"));
    send(session.client, {
      type: "gc",
      event: {
        id: randomUUID(),
        t,
        reason: String(event.reason ?? event.type ?? "gc"),
        isolate: session.isolateId,
      },
    });
    return;
  }

  if (kind === "Extension") {
    const extensionKind = String(event.extensionKind ?? "");
    const data = (event.extensionData ?? {}) as Record<string, unknown>;
    if (extensionKind === "Flutter.Frame") {
      const buildMs = usToMs(Number(data.build ?? 0));
      const rasterMs = usToMs(Number(data.raster ?? 0));
      const vsyncMs = usToMs(Number(data.vsyncOverhead ?? 0));
      const elapsedMs = usToMs(Number(data.elapsed ?? 0));
      const frameMs =
        elapsedMs > 0 ? elapsedMs : Math.max(buildMs + rasterMs + vsyncMs * 0.25, buildMs + rasterMs);
      session.lastBuildMs = buildMs;
      session.lastRasterMs = rasterMs;
      session.lastVsyncMs = vsyncMs;
      session.lastFrameMs = frameMs;
      session.jankWindow.push(frameMs > FRAME_BUDGET_MS ? 1 : 0);
      if (session.jankWindow.length > 30) session.jankWindow.shift();
      if (frameMs > FRAME_BUDGET_MS) {
        pushMarker(session, "jank", `Jank frame ${frameMs.toFixed(1)} ms`);
      }
    }
  }

  if (kind === "Timeline" || kind === "TimelineEvents") {
    const events = (event.timelineEvents ?? event.events ?? []) as Array<
      Record<string, unknown>
    >;
    for (const te of events) {
      const name = String(te.name ?? "");
      if (/shader|compile/i.test(name)) {
        pushMarker(session, "shader", name || "Shader compile");
      }
      if (typeof te.dur !== "number") continue;
      const ms = te.dur / 1000;
      if (ms <= 0 || ms >= 500) continue;
      if (/^BUILD$/i.test(name)) session.lastBuildMs = ms;
      else if (/RASTER|GPU/i.test(name)) session.lastRasterMs = ms;
      else if (/Frame/i.test(name)) {
        session.lastFrameMs = ms;
        session.jankWindow.push(ms > FRAME_BUDGET_MS ? 1 : 0);
        if (session.jankWindow.length > 30) session.jankWindow.shift();
        if (ms > FRAME_BUDGET_MS) {
          pushMarker(session, "jank", `Timeline frame ${ms.toFixed(1)} ms`);
        }
      }
    }
  }
}

async function pollLiveMetrics(session: Session) {
  if (session.mode !== "live" || !session.isolateId) return;
  const mem = await pollMemory(session);
  const buildMs = session.lastBuildMs;
  const rasterMs = session.lastRasterMs;
  const vsyncMs = session.lastVsyncMs;
  const frameMs =
    session.lastFrameMs || Math.max(buildMs + rasterMs, 0);
  const pressure = framePressure(buildMs, rasterMs, frameMs);

  send(session.client, {
    type: "metrics",
    point: {
      t: Date.now(),
      cpu: pressure,
      framePressure: pressure,
      frameMs: Number(frameMs.toFixed(2)),
      buildMs: Number(buildMs.toFixed(2)),
      rasterMs: Number(rasterMs.toFixed(2)),
      vsyncMs: Number(vsyncMs.toFixed(2)),
      jank: frameMs > FRAME_BUDGET_MS ? 1 : 0,
      heapMb: Number(mem.heapMb.toFixed(2)),
      externalMb: Number(mem.externalMb.toFixed(2)),
    },
  });

  await pollHttpProfile(session);
}

async function connectVm(session: Session, url: string) {
  if (!isValidVmUrl(url)) {
    send(session.client, {
      type: "status",
      status: "error",
      message: "Enter a valid ws:// or wss:// VM Service URL (e.g. ws://127.0.0.1:8181/ws)",
    });
    return;
  }

  disconnectVm(session);
  session.mode = "idle";
  send(session.client, {
    type: "status",
    status: "connecting",
    mode: "live",
    message: `Connecting to ${url}`,
  });

  const vm = new WebSocket(url);
  session.vm = vm;

  vm.on("open", async () => {
    try {
      const isolateName = await resolveIsolate(session);
      await listenStreams(session);
      await refreshExtensions(session);
      await startWidgetProbe(session);
      await probeCapabilities(session);
      session.mode = "live";
      session.lastFrameMs = 12;
      session.lastBuildMs = 7;
      session.lastRasterMs = 4;
      session.lastVsyncMs = 1;
      session.seenHttpIds.clear();
      session.memorySnapshots = [];
      session.timelineMarkers = [];
      send(session.client, {
        type: "status",
        status: "connected",
        mode: "live",
        message: `Connected to VM Service`,
        isolateName,
      });
      void handleDebugOptions(session, "get");
      if (session.caps.scenarios) {
        void handleScenario(session, "list");
      }
      session.pollTimer = setInterval(() => {
        void pollLiveMetrics(session);
      }, 500);
      session.hotWidgetTimer = setInterval(() => {
        void pollHotWidgets(session);
      }, 1000);
      void pollHotWidgets(session);
      // Extensions sometimes register slightly after first frame
      setTimeout(() => {
        void (async () => {
          await refreshExtensions(session);
          await startWidgetProbe(session);
          await probeCapabilities(session);
          if (session.caps.scenarios) void handleScenario(session, "list");
        })();
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize VM session";
      disconnectVm(session);
      send(session.client, { type: "status", status: "error", message });
    }
  });

  vm.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        id?: string;
        error?: { message?: string };
        result?: unknown;
        method?: string;
        params?: { event?: Record<string, unknown> };
      };
      if (msg.id && session.pending.has(String(msg.id))) {
        const pending = session.pending.get(String(msg.id))!;
        session.pending.delete(String(msg.id));
        if (msg.error) {
          pending.reject(new Error(msg.error.message ?? "VM RPC error"));
        } else {
          pending.resolve(msg);
        }
        return;
      }
      if (msg.method === "streamNotify" && msg.params?.event) {
        handleVmEvent(session, msg.params.event);
      }
    } catch {
      /* ignore malformed */
    }
  });

  vm.on("error", (err) => {
    send(session.client, {
      type: "status",
      status: "error",
      message: `VM Service error: ${err.message}`,
    });
  });

  vm.on("close", () => {
    if (session.vm === vm) {
      clearTimers(session);
      session.vm = undefined;
      session.mode = "idle";
      send(session.client, {
        type: "status",
        status: "disconnected",
        message: "VM Service closed the connection",
      });
    }
  });
}

async function handleDebugOptions(
  session: Session,
  action: string,
  id?: string,
  enabled?: boolean,
) {
  if (session.mode === "mock") {
    if (action === "set" && id && typeof enabled === "boolean" && id in session.mockDebugOptions) {
      session.mockDebugOptions[id] = enabled;
    }
    emitMockDebugOptions(
      session,
      action === "set" && id
        ? `Demo: ${id} ${enabled ? "on" : "off"} (no device overlay)`
        : undefined,
    );
    return;
  }
  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, {
      type: "debugOptions",
      options: [],
      message: "Connect to a Flutter app to use debug overlays",
    });
    return;
  }

  if (action === "set") {
    if (!id || typeof enabled !== "boolean") {
      send(session.client, {
        type: "error",
        message: "debugOptions set requires id and enabled",
      });
      return;
    }
    const def = DEBUG_OPTION_DEFS.find((d) => d.id === id);
    if (!def) {
      send(session.client, { type: "error", message: `Unknown debug option: ${id}` });
      return;
    }
    if (!session.extensionMethods.includes(def.method)) {
      send(session.client, {
        type: "error",
        message: `${def.method} is not available on this isolate (needs a debug/profile Flutter app)`,
      });
      await readLiveDebugOptions(session, "Some Flutter debug extensions are unavailable");
      return;
    }
    try {
      if (def.kind === "timeDilation") {
        await rpc(session, def.method, {
          isolateId: session.isolateId,
          timeDilation: enabled ? String(SLOW_ANIMATION_DILATION) : "1.0",
        });
      } else {
        await rpc(session, def.method, {
          isolateId: session.isolateId,
          enabled: String(enabled),
        });
      }
    } catch (err) {
      send(session.client, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await readLiveDebugOptions(session, `${def.id} ${enabled ? "enabled" : "disabled"}`);
    return;
  }

  await readLiveDebugOptions(session);
}

function parseBoolFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

async function readLiveDebugOptions(session: Session, message?: string) {
  const options: Array<{ id: string; enabled: boolean; available: boolean }> = [];
  for (const def of DEBUG_OPTION_DEFS) {
    const available = session.extensionMethods.includes(def.method);
    let enabled = false;
    if (available) {
      try {
        const res = (await rpc(session, def.method, {
          isolateId: session.isolateId,
        })) as { result?: Record<string, unknown> };
        const result = res.result ?? {};
        if (def.kind === "timeDilation") {
          const dilation = Number(result.timeDilation ?? result.value ?? 1);
          enabled = dilation > 1;
        } else {
          enabled = parseBoolFlag(result.enabled);
        }
      } catch {
        options.push({ id: def.id, enabled: false, available: false });
        continue;
      }
    }
    options.push({ id: def.id, enabled, available });
  }
  send(session.client, {
    type: "debugOptions",
    options,
    ...(message ? { message } : {}),
  });
}

function emitMockDebugOptions(session: Session, message?: string) {
  send(session.client, {
    type: "debugOptions",
    options: DEBUG_OPTION_DEFS.map((d) => ({
      id: d.id,
      enabled: session.mockDebugOptions[d.id] ?? false,
      available: true,
    })),
    message: message ?? "Demo debug options — toggles are local only",
  });
}

async function runStress(session: Session, action: string, params?: Record<string, unknown>) {
  if (session.mode === "mock") {
    // Simulate a load spike in mock metrics
    let bursts = 0;
    const spike = setInterval(() => {
      bursts += 1;
      const t = Date.now();
      const buildMs = 18 + Math.random() * 24;
      const rasterMs = 10 + Math.random() * 16;
      const frameMs = buildMs + rasterMs;
      const pressure = framePressure(buildMs, rasterMs, frameMs);
      send(session.client, {
        type: "metrics",
        point: {
          t,
          cpu: pressure,
          framePressure: pressure,
          frameMs: Number(frameMs.toFixed(2)),
          buildMs: Number(buildMs.toFixed(2)),
          rasterMs: Number(rasterMs.toFixed(2)),
          vsyncMs: Number((1 + Math.random()).toFixed(2)),
          jank: 1,
          heapMb: 55 + bursts * 1.5 + Math.random() * 3,
          externalMb: 12 + Math.random() * 2,
        },
      });
      if (action.includes("invoice") || action === "injectInvoices") {
        send(session.client, {
          type: "network",
          available: true,
          request: {
            id: randomUUID(),
            t,
            method: "POST",
            uri: "/api/invoices/bulk",
            latencyMs: Number((180 + Math.random() * 220).toFixed(1)),
            requestBytes: 12000 + bursts * 800,
            responseBytes: 2400,
            status: 201,
          },
        });
      }
      if (bursts >= 8) clearInterval(spike);
    }, 200);
    send(session.client, {
      type: "status",
      status: "connected",
      mode: "mock",
      message: `Mock stress "${action}" fired`,
    });
    return;
  }

  if (session.mode !== "live" || !session.isolateId) {
    send(session.client, {
      type: "error",
      message: "Connect to a Flutter VM Service (or start demo mode) before running stress tests",
    });
    return;
  }

  const methodMap: Record<string, string> = {
    injectInvoices: "ext.pulseflow.injectInvoices",
    spikeCpu: "ext.pulseflow.spikeCpu",
    allocateMemory: "ext.pulseflow.allocateMemory",
  };
  const method = methodMap[action] ?? action;
  if (!session.extensionMethods.includes(method)) {
    send(session.client, {
      type: "extension",
      info: {
        available: false,
        methods: session.extensionMethods.filter((m) => m.startsWith("ext.pulseflow.")),
        message: `Extension ${method} unavailable — add the PulseFlow stub to your Flutter app`,
      },
    });
    send(session.client, {
      type: "error",
      message: `Stress action unavailable: ${method} is not registered on the isolate`,
    });
    return;
  }

  try {
    await rpc(session, method, {
      isolateId: session.isolateId,
      ...(params ?? { count: 100 }),
    });
    send(session.client, {
      type: "status",
      status: "connected",
      mode: "live",
      message: `Stress RPC ${method} completed`,
    });
  } catch (err) {
    send(session.client, {
      type: "error",
      message: err instanceof Error ? err.message : "Stress RPC failed",
    });
  }
}

function attachClient(client: WebSocket) {
  const session: Session = {
    client,
    mode: "idle",
    pending: new Map(),
    seq: 0,
    lastFrameMs: 0,
    lastBuildMs: 0,
    lastRasterMs: 0,
    lastVsyncMs: 0,
    jankWindow: [],
    extensionMethods: [],
    httpProfileSupported: null,
    widgetProbeAvailable: null,
    hotWidgetsFrozen: false,
    recordQuietUntil: 0,
    mockSessionRebuilds: new Map(),
    caps: { ...DEFAULT_CAPS },
    cpuRecording: false,
    memorySnapshots: [],
    seenHttpIds: new Set(),
    scenarioRunning: null,
    timelineMarkers: [],
    mockDebugOptions: Object.fromEntries(DEBUG_OPTION_DEFS.map((d) => [d.id, false])),
  };

  send(client, {
    type: "status",
    status: "idle",
    message: "Bridge ready — connect a VM Service URL or start demo mode",
  });

  client.on("message", (raw) => {
    void (async () => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMsg;
        switch (msg.type) {
          case "connect":
            await connectVm(session, msg.url);
            break;
          case "disconnect":
            disconnectVm(session, "Disconnected by user");
            send(client, { type: "status", status: "idle", message: "Disconnected" });
            break;
          case "mock":
            startMock(session);
            break;
          case "discover": {
            send(client, {
              type: "status",
              status: session.mode === "idle" ? "idle" : "connected",
              mode: session.mode === "mock" ? "mock" : session.mode === "live" ? "live" : undefined,
              message: "Scanning for local Flutter / Dart VM Services…",
            });
            try {
              const apps = await discoverRunningApps();
              send(client, { type: "discover", apps });
              send(client, {
                type: "status",
                status: session.mode === "idle" ? "idle" : "connected",
                mode: session.mode === "mock" ? "mock" : session.mode === "live" ? "live" : undefined,
                message:
                  apps.length === 0
                    ? "No local Flutter apps found — run an app with flutter run, or paste the VM Service URL"
                    : `Found ${apps.length} local Dart/Flutter service${apps.length === 1 ? "" : "s"}`,
              });
            } catch (err) {
              send(client, {
                type: "error",
                message: err instanceof Error ? err.message : "Discovery failed",
              });
            }
            break;
          }
          case "stress":
            await runStress(session, msg.action, msg.params);
            break;
          case "refreshExtensions":
            if (session.mode === "mock") {
              send(client, {
                type: "extension",
                info: {
                  available: true,
                  methods: [
                    "ext.pulseflow.injectInvoices",
                    "ext.pulseflow.spikeCpu",
                    "ext.pulseflow.allocateMemory",
                    "ext.pulseflow.listScenarios",
                    "ext.pulseflow.runScenario",
                    "ext.pulseflow.stopScenario",
                  ],
                  message: "Mock stress actions simulate load locally",
                },
              });
              send(client, {
                type: "scenarioStatus",
                scenarios: MOCK_SCENARIOS,
                running: session.scenarioRunning,
              });
              emitMockDebugOptions(session);
            } else if (session.mode === "live") {
              await refreshExtensions(session);
              await probeCapabilities(session);
              if (session.caps.scenarios) void handleScenario(session, "list");
              void handleDebugOptions(session, "get");
            } else {
              send(client, {
                type: "extension",
                info: {
                  available: false,
                  methods: [],
                  message: "Connect first to detect PulseFlow extensions",
                },
              });
            }
            break;
          case "hotWidgetsControl":
            await runHotWidgetsControl(session, msg.action);
            break;
          case "cpuRecord":
            await handleCpuRecord(session, msg.action, msg.durationMs);
            break;
          case "scenario":
            await handleScenario(session, msg.action, msg.id, msg.params);
            break;
          case "memorySnapshot":
            await handleMemorySnapshot(
              session,
              msg.action,
              msg.snapshotId,
              msg.classId,
              msg.objectId,
            );
            break;
          case "timelineExport":
            await handleTimelineExport(session, msg.durationMs);
            break;
          case "networkControl":
            await handleNetworkControl(session, msg.action);
            break;
          case "debugOptions":
            await handleDebugOptions(session, msg.action, msg.id, msg.enabled);
            break;
          default:
            send(client, { type: "error", message: "Unknown bridge command" });
        }
      } catch (err) {
        send(client, {
          type: "error",
          message: err instanceof Error ? err.message : "Invalid bridge message",
        });
      }
    })();
  });

  client.on("close", () => {
    disconnectVm(session);
  });
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ service: "pulseflow-bridge", port: BRIDGE_PORT, ok: true }));
});

const wss = new WebSocketServer({ server, path: "/bridge" });
wss.on("connection", (socket) => attachClient(socket));

server.listen(BRIDGE_PORT, "0.0.0.0", () => {
  console.log(`PulseFlow bridge listening on http://0.0.0.0:${BRIDGE_PORT} (ws path /bridge)`);
});
