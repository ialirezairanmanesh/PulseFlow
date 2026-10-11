/**
 * React-free reducer for the PulseFlow bridge protocol.
 *
 * Mirrors the `pulse-store` message switch so the MCP server ranks problems,
 * scores health, and builds the agent report **identically** to the dashboard.
 */
import { buildAgentReportJson, buildAgentReportMarkdown } from "@/lib/agent-report";
import { normalizeHotWidgetsMessage } from "@/lib/normalize-hot";
import { buildProblems, computeBaselineMetrics } from "@/lib/problems";
import { computeVerdict, type HealthVerdict } from "@/lib/verdict";
import type { SessionStats } from "@/lib/session-history";
import type {
  AttributedRebuild,
  BridgeHotWidgetsMessage,
  BridgeServerMessage,
  CapabilityMap,
  ConnectionStatus,
  CpuProfileSummary,
  DebugOptionState,
  DeviceDisplayInfo,
  DiscoveredApp,
  ErrorEntry,
  ExtensionInfo,
  GcEvent,
  HotWidgetsPayload,
  ImageCacheStats,
  LeakEntry,
  LogMessage,
  MemoryDiff,
  MemorySnapshot,
  MetricPoint,
  NetworkRequest,
  OversizedImage,
  PerformanceProblem,
  ProbeAvailability,
  RebuildCauseRoot,
  RetainingPathNode,
  ScenarioInfo,
  ScenarioResult,
  SocketSample,
  StallEntry,
  TimelineMarker,
} from "@/lib/types";

const MAX_POINTS = 60;
const MAX_GC = 40;
const MAX_NET = 200;
const MAX_LOGS = 500;

export interface DeviceContextSnapshot {
  available: boolean;
  platform?: string;
  buildMode?: string;
  locale?: string;
  textScale?: number;
  appPackage?: string;
  display?: DeviceDisplayInfo;
  extras?: Record<string, unknown>;
}

export interface StallsSnapshot {
  available: boolean;
  active?: boolean;
  thresholdMs?: number;
  total: number;
  maxDurationMs: number;
  stalls: StallEntry[];
}

export interface RebuildCausesSnapshot {
  available: boolean;
  windowMs: number;
  roots: RebuildCauseRoot[];
  attributed: AttributedRebuild[];
}

export interface ImagesSnapshot {
  available: boolean;
  cache: ImageCacheStats;
  oversized: OversizedImage[];
}

export interface BuildInfoSnapshot {
  buildMode: string;
  probes: ProbeAvailability;
}

export interface McpSessionState {
  bridgeReady: boolean;
  status: ConnectionStatus;
  statusMessage: string;
  mode?: "live" | "mock";
  isolateName?: string;
  error?: string;
  points: MetricPoint[];
  gcEvents: GcEvent[];
  network: NetworkRequest[];
  sockets: SocketSample[];
  networkAvailable: boolean | null;
  networkMessage?: string;
  extension: ExtensionInfo | null;
  discovered: DiscoveredApp[];
  discovering: boolean;
  hot: HotWidgetsPayload | null;
  hotAvailable: boolean | null;
  hotMessage?: string;
  probeFrozen: boolean;
  capabilities: CapabilityMap | null;
  cpuProfile: CpuProfileSummary | null;
  cpuRecording: boolean;
  cpuMessage?: string;
  scenarios: ScenarioInfo[];
  scenarioRunning: string | null;
  scenarioResult: ScenarioResult | null;
  memorySnapshots: MemorySnapshot[];
  memoryDiff: MemoryDiff | null;
  retainingPath: RetainingPathNode[] | null;
  memoryMessage?: string;
  timelineMarkers: TimelineMarker[];
  leaks: LeakEntry[];
  rebuildCauses: RebuildCausesSnapshot | null;
  appErrors: ErrorEntry[];
  images: ImagesSnapshot | null;
  buildInfo: BuildInfoSnapshot | null;
  deviceContext: DeviceContextSnapshot | null;
  stalls: StallsSnapshot | null;
  logs: LogMessage[];
  debugOptions: DebugOptionState[];
  debugOptionsMessage?: string;
  /** Wall-clock ms of the last applied message. */
  lastMessageAt: number;
  /** Total messages applied since the process started. */
  messageCount: number;
}

export function createSessionState(): McpSessionState {
  return {
    bridgeReady: false,
    status: "idle",
    statusMessage: "Not connected",
    points: [],
    gcEvents: [],
    network: [],
    sockets: [],
    networkAvailable: null,
    extension: null,
    discovered: [],
    discovering: false,
    hot: null,
    hotAvailable: null,
    probeFrozen: false,
    capabilities: null,
    cpuProfile: null,
    cpuRecording: false,
    scenarios: [],
    scenarioRunning: null,
    scenarioResult: null,
    memorySnapshots: [],
    memoryDiff: null,
    retainingPath: null,
    timelineMarkers: [],
    leaks: [],
    rebuildCauses: null,
    appErrors: [],
    images: null,
    buildInfo: null,
    deviceContext: null,
    stalls: null,
    logs: [],
    debugOptions: [],
    lastMessageAt: 0,
    messageCount: 0,
  };
}

/** Drops all telemetry (mirrors `clearTelemetry` in the store). Keeps bridge status. */
export function clearTelemetry(state: McpSessionState): McpSessionState {
  const fresh = createSessionState();
  fresh.bridgeReady = state.bridgeReady;
  fresh.status = state.status;
  fresh.statusMessage = state.statusMessage;
  return Object.assign(state, fresh);
}

/** Applies one bridge message to the state in place and returns it. */
export function applyMessage(state: McpSessionState, msg: BridgeServerMessage): McpSessionState {
  state.messageCount += 1;
  state.lastMessageAt = Date.now();

  switch (msg.type) {
    case "status":
      state.status = msg.status;
      state.statusMessage = msg.message ?? msg.status;
      if (msg.mode) state.mode = msg.mode;
      if (msg.isolateName) state.isolateName = msg.isolateName;
      if (msg.status === "error") state.error = msg.message;
      else if (msg.status === "connected" || msg.status === "idle") state.error = undefined;
      if (msg.status === "disconnected" || msg.status === "idle") {
        state.probeFrozen = false;
      }
      break;
    case "metrics":
      state.points = [...state.points, msg.point].slice(-MAX_POINTS);
      break;
    case "gc":
      state.gcEvents = [...state.gcEvents, msg.event].slice(-MAX_GC);
      break;
    case "network": {
      state.networkAvailable = msg.available;
      if (msg.message) state.networkMessage = msg.message;
      if (msg.requests) {
        if (msg.requests.length === 0) {
          state.network = [];
        } else {
          const map = new Map(state.network.map((r) => [r.id, r]));
          for (const r of msg.requests) map.set(r.id, r);
          state.network = [...map.values()].slice(-MAX_NET);
        }
      } else if (msg.request) {
        const map = new Map(state.network.map((r) => [r.id, r]));
        map.set(msg.request.id, msg.request);
        state.network = [...map.values()].slice(-MAX_NET);
      }
      if (msg.sockets) state.sockets = msg.sockets.slice(-40);
      break;
    }
    case "extension":
      state.extension = msg.info;
      break;
    case "hotWidgets": {
      const normalized = normalizeHotWidgetsMessage(msg as BridgeHotWidgetsMessage);
      if (state.probeFrozen && !normalized.frozen) break;
      if (normalized.frozen) state.probeFrozen = true;
      state.hot = normalized;
      state.hotAvailable = normalized.available;
      if (normalized.message) state.hotMessage = normalized.message;
      break;
    }
    case "discover":
      state.discovered = msg.apps;
      state.discovering = false;
      break;
    case "error":
      state.error = msg.message;
      state.discovering = false;
      break;
    case "capabilities":
      state.capabilities = msg.caps;
      if (msg.caps.cpuSamples === false) {
        state.cpuMessage =
          typeof msg.cpuProbeError === "string" && msg.cpuProbeError
            ? `CPU probe failed: ${msg.cpuProbeError}`
            : msg.message ||
              "getCpuSamples is not available on this VM. Run the app in profile mode with the CPU profiler enabled.";
      }
      break;
    case "cpuProfile":
      state.cpuRecording = Boolean(msg.recording);
      if (msg.message) state.cpuMessage = msg.message;
      if (msg.profile) state.cpuProfile = msg.profile;
      if (msg.available === false && !msg.recording) {
        state.cpuMessage = msg.message ?? "CPU profile unavailable";
      }
      break;
    case "scenarioStatus":
      if (msg.scenarios) state.scenarios = msg.scenarios;
      if (msg.running !== undefined) state.scenarioRunning = msg.running ?? null;
      if (msg.result) state.scenarioResult = msg.result;
      break;
    case "memoryProfile":
      if (msg.message) state.memoryMessage = msg.message;
      if (msg.snapshot) {
        const next = [
          ...state.memorySnapshots.filter((s) => s.id !== msg.snapshot!.id),
          msg.snapshot,
        ];
        state.memorySnapshots = next.slice(-4);
      }
      if (msg.diff) state.memoryDiff = msg.diff;
      if (msg.retainingPath) state.retainingPath = msg.retainingPath;
      break;
    case "timelineExport":
      if (msg.markers) state.timelineMarkers = msg.markers;
      break;
    case "leaks":
      state.leaks = msg.available ? (msg.leaked ?? []) : [];
      break;
    case "rebuildCauses":
      state.rebuildCauses = {
        available: msg.available,
        windowMs: msg.windowMs,
        roots: msg.roots ?? [],
        attributed: msg.attributed ?? [],
      };
      break;
    case "errors":
      state.appErrors = msg.available ? (msg.errors ?? []) : [];
      break;
    case "images":
      state.images = {
        available: msg.available,
        cache: msg.cache,
        oversized: msg.oversized ?? [],
      };
      break;
    case "buildInfo":
      state.buildInfo = { buildMode: msg.buildMode, probes: msg.probes ?? {} };
      break;
    case "deviceContext":
      state.deviceContext = {
        available: msg.available,
        platform: msg.platform,
        buildMode: msg.buildMode,
        locale: msg.locale,
        textScale: msg.textScale,
        appPackage: msg.appPackage,
        display: msg.display,
        extras: msg.extras,
      };
      break;
    case "stalls":
      state.stalls = {
        available: msg.available,
        active: msg.active,
        thresholdMs: msg.thresholdMs,
        total: msg.total ?? 0,
        maxDurationMs: msg.maxDurationMs ?? 0,
        stalls: msg.stalls ?? [],
      };
      break;
    case "log": {
      const raw = msg.entry;
      const entry: LogMessage = {
        id: `${raw.t}-${raw.seq ?? state.logs.length}-${state.logs.length}`,
        t: raw.t,
        level: raw.level,
        severity: raw.severity,
        message: raw.message,
        loggerName: raw.loggerName,
      };
      const next = [...state.logs, entry];
      state.logs = next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      break;
    }
    case "debugOptions":
      state.debugOptions = msg.options ?? [];
      if (msg.message) state.debugOptionsMessage = msg.message;
      break;
  }
  return state;
}

/** Ranked problems for the current session — same logic as the dashboard. */
export function problemsOf(state: McpSessionState): PerformanceProblem[] {
  return buildProblems({
    hot: state.hot,
    hotAvailable: state.hotAvailable,
    latest: state.points.at(-1),
    gcEvents: state.gcEvents,
    cpuProfile: state.cpuProfile,
    memoryDiff: state.memoryDiff,
    network: state.network,
    points: state.points,
    scenarioResult: state.scenarioResult,
    scenarioRunning: state.scenarioRunning,
    rebuildCauses: state.rebuildCauses,
    errors: state.appErrors,
    stalls: state.stalls,
  });
}

export function verdictOf(state: McpSessionState): HealthVerdict {
  return computeVerdict({
    points: state.points,
    problems: problemsOf(state),
    budgetMs: state.points.at(-1)?.buildBudgetMs,
  });
}

export function sessionStatsOf(state: McpSessionState): SessionStats {
  const metrics = computeBaselineMetrics({
    points: state.points,
    hot: state.hot,
    problemCount: problemsOf(state).length,
    label: "mcp",
  });
  return {
    problemCount: metrics.problemCount,
    p95BuildMs: metrics.p95BuildMs,
    p95RasterMs: metrics.p95RasterMs,
    p95FrameMs: metrics.p95FrameMs,
    rebuildRate: metrics.rebuildRate,
    heapMb: metrics.heapMb,
    jankRatio: metrics.jankRatio,
  };
}

function agentReportInput(state: McpSessionState) {
  const latest = state.points.at(-1);
  return {
    capturedAt: Date.now(),
    mode: state.mode,
    isolateName: state.isolateName,
    refreshRate: latest?.refreshRate,
    budgetMs: latest?.buildBudgetMs,
    problems: problemsOf(state),
    rebuildRoots: state.rebuildCauses?.roots,
    errors: state.appErrors,
    imageStats: state.images,
    cpuProfile: state.cpuProfile,
    memoryDiff: state.memoryDiff,
    network: state.network,
    hot: state.hot,
    stats: sessionStatsOf(state),
    baselines: [],
    buildInfo: state.buildInfo,
  };
}

export function reportMarkdownOf(state: McpSessionState): string {
  return buildAgentReportMarkdown(agentReportInput(state));
}

export function reportJsonOf(state: McpSessionState): ReturnType<typeof buildAgentReportJson> {
  return buildAgentReportJson(agentReportInput(state));
}

/** True once the session has any telemetry worth reporting. */
export function hasTelemetry(state: McpSessionState): boolean {
  return (
    state.points.length > 0 ||
    state.hot != null ||
    state.cpuProfile != null ||
    state.appErrors.length > 0 ||
    state.network.length > 0
  );
}
