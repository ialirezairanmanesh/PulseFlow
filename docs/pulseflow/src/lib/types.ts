export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface MetricPoint {
  t: number;
  /** @deprecated use framePressure — kept for older payloads */
  cpu: number;
  framePressure: number;
  frameMs: number;
  buildMs: number;
  rasterMs: number;
  vsyncMs: number;
  jank: number;
  heapMb: number;
  externalMb: number;
  /** Display refresh rate reported by the app probe, when available. */
  refreshRate?: number;
  /** Per-frame budget in ms (`1000 / refreshRate`), when available. */
  buildBudgetMs?: number;
}

export interface GcEvent {
  id: string;
  t: number;
  reason: string;
  isolate?: string;
}

/** A runtime log entry forwarded from the VM Service `Logging` stream. */
export type LogLevel = "debug" | "info" | "warning" | "error" | "severe";

export interface LogMessage {
  id: string;
  t: number;
  level: LogLevel;
  /** Numeric package:logging severity (>= 800 = warning-ish threshold). */
  severity: number;
  message: string;
  loggerName?: string;
  /** Bridge-side sequence number (for client-side deduplication). */
  seq?: number;
}

export interface BridgeLogMessage {
  type: "log";
  entry: LogMessage;
}

export interface NetworkRequest {
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
}

export interface SocketSample {
  id: string;
  t: number;
  address: string;
  port?: number;
  readBytes: number;
  writeBytes: number;
  lastReadLatencyMs?: number;
}

export interface ExtensionInfo {
  available: boolean;
  methods: string[];
  message?: string;
}

/** @deprecated Use WidgetRebuildStat — kept for older probe payloads */
export interface HotWidget {
  name: string;
  rebuilds: number;
  share: number;
  lastSeenMs?: number;
}

export interface WidgetRebuildStat {
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
  /** Source file reported by the widget inspector (debug/profile). */
  sourceUri?: string;
  /** 1-based source line for the widget. */
  sourceLine?: number;
  /** Rebuild root this widget was attributed to, when known. */
  cause?: string;
  /** Parent node id when this row comes from a mounted element-tree walk. */
  parentId?: string;
  /** Depth in the mounted tree (0 = route root). */
  depth?: number;
  /** True when the widget is currently mounted in the element tree. */
  inTree?: boolean;
}

export interface ScreenRebuildStat {
  route: string;
  rebuildsWindow: number;
  ratePerSec: number;
  share: number;
  topWidgets: WidgetRebuildStat[];
}

export type ProblemKind =
  | "hot_rebuild"
  | "high_build"
  | "high_raster"
  | "gc_pressure"
  | "missing_probe"
  | "cpu_hotspot"
  | "scenario_jank"
  | "memory_growth"
  | "slow_http"
  | "error_overflow"
  | "error_exception"
  | "ui_stall";

export interface PerformanceProblem {
  id: string;
  severity: "high" | "medium" | "low";
  kind: ProblemKind;
  title: string;
  detail: string;
  action: string;
  route?: string;
  widget?: string;
  ratePerSec?: number;
  share?: number;
  /** HTTP latency in ms (slow_http only). Do not overload ratePerSec for this. */
  latencyMs?: number;
  relatedBuildMs?: number;
  sourceUri?: string;
  sourceLine?: number;
  /** Normalized 0–100 priority (severity base × magnitude × jank/cost). Higher = fix sooner. */
  impact?: number;
  /** One plain-language cause→effect sentence generated from measured data. */
  why?: string;
  /** Rebuild root that triggered this problem (rebuilds only, when known). */
  cause?: string;
  /** True when this item was observed during a janky frame. */
  duringJank?: boolean;
}

export interface HotWidgetsPayload {
  available: boolean;
  windowMs: number;
  totalRebuildsWindow: number;
  totalRebuildsSession: number;
  /** Most recently observed route/screen label from the widget probe. */
  currentRoute?: string;
  widgets: WidgetRebuildStat[];
  /**
   * Mounted element tree for the current route (preorder). Prefer this over
   * `widgets` on the Widgets page so rows stay while the screen is open.
   */
  tree?: WidgetRebuildStat[];
  screens: ScreenRebuildStat[];
  problems?: PerformanceProblem[];
  frozen?: boolean;
  duringJank?: boolean;
  message?: string;
}

export interface CapabilityMap {
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
  deviceContext?: boolean;
  stalls?: boolean;
}

export interface FlameNode {
  name: string;
  value: number;
  children?: FlameNode[];
}

export interface CpuFunctionStat {
  name: string;
  qualifiedName: string;
  selfMs: number;
  totalMs: number;
  selfPercent: number;
  totalPercent: number;
  codeUri?: string;
}

export interface CpuProfileSummary {
  durationMs: number;
  sampleCount: number;
  samplePeriodMicros?: number;
  topFunctions: CpuFunctionStat[];
  flameRoot: FlameNode;
  capturedAt: number;
}

export interface ScenarioInfo {
  id: string;
  label: string;
  description: string;
  paramsSchema?: Record<string, unknown>;
}

export interface ScenarioResult {
  id: string;
  ok: boolean;
  stopped?: boolean;
  stubbed?: boolean;
  reason?: string;
  durationMs?: number;
  message?: string;
}

export interface AllocationClassStat {
  className: string;
  instances: number;
  bytes: number;
  classId?: string;
}

export interface MemorySnapshot {
  id: string;
  t: number;
  heapMb: number;
  externalMb: number;
  classes: AllocationClassStat[];
}

export interface MemoryDiffEntry {
  className: string;
  classId?: string;
  instancesDelta: number;
  bytesDelta: number;
}

export interface MemoryDiff {
  fromId: string;
  toId: string;
  grew: MemoryDiffEntry[];
}

export interface RetainingPathNode {
  label: string;
  kind?: string;
}

export interface TimelineMarker {
  id: string;
  t: number;
  kind: "jank" | "gc" | "shader" | "other";
  label: string;
}

export interface SessionBaseline {
  id: string;
  label: string;
  t: number;
  p95BuildMs: number;
  p95RasterMs: number;
  p95FrameMs: number;
  rebuildRate: number;
  heapMb: number;
  jankRatio: number;
  problemCount: number;
}

export interface BridgeStatusMessage {
  type: "status";
  status: ConnectionStatus;
  message?: string;
  mode?: "live" | "mock";
  isolateName?: string;
}

export interface BridgeMetricsMessage {
  type: "metrics";
  point: MetricPoint;
}

export interface BridgeGcMessage {
  type: "gc";
  event: GcEvent;
}

export interface BridgeNetworkMessage {
  type: "network";
  available: boolean;
  request?: NetworkRequest;
  requests?: NetworkRequest[];
  sockets?: SocketSample[];
  message?: string;
}

export interface BridgeExtensionMessage {
  type: "extension";
  info: ExtensionInfo;
}

export interface BridgeHotWidgetsMessage extends HotWidgetsPayload {
  type: "hotWidgets";
  /** @deprecated use totalRebuildsWindow */
  totalRebuilds?: number;
}

export interface BridgeErrorMessage {
  type: "error";
  message: string;
}

export interface DiscoveredApp {
  id: string;
  name: string;
  wsUrl: string;
  httpUrl: string;
  port: number;
  source: "mdns" | "port-scan" | "service-info" | "adb" | "dds";
  isolateName?: string;
  connectable: boolean;
  detail?: string;
  deviceName?: string;
  /** ADB serial (e.g. `localhost:5555` or USB id) when known. */
  deviceSerial?: string;
}

export interface BridgeDiscoverMessage {
  type: "discover";
  apps: DiscoveredApp[];
}

export interface BridgeCapabilitiesMessage {
  type: "capabilities";
  caps: CapabilityMap;
  message?: string;
  cpuProbeError?: string;
}

export interface BridgeCpuProfileMessage {
  type: "cpuProfile";
  available: boolean;
  recording?: boolean;
  profile?: CpuProfileSummary;
  message?: string;
}

export interface BridgeScenarioStatusMessage {
  type: "scenarioStatus";
  scenarios?: ScenarioInfo[];
  running?: string | null;
  result?: ScenarioResult;
  message?: string;
}

export interface BridgeMemoryProfileMessage {
  type: "memoryProfile";
  available: boolean;
  snapshot?: MemorySnapshot;
  diff?: MemoryDiff;
  retainingPath?: RetainingPathNode[];
  message?: string;
}

export interface BridgeTimelineExportMessage {
  type: "timelineExport";
  available: boolean;
  format: "perfetto" | "json";
  base64?: string;
  fileName?: string;
  markers?: TimelineMarker[];
  message?: string;
}

export interface LeakEntry {
  className: string;
  count: number;
}

export interface BridgeLeaksMessage {
  type: "leaks";
  available: boolean;
  leaked: LeakEntry[];
  message?: string;
}

export interface BridgeCpuExportMessage {
  type: "cpuExport";
  available: boolean;
  format: "speedscope";
  base64?: string;
  fileName?: string;
  message?: string;
}

export interface RebuildCauseRoot {
  id: string;
  widget: string;
  route: string;
  cause: string;
  rebuilds: number;
  ratePerSec: number;
  children: number;
  sourceUri?: string;
  sourceLine?: number;
}

export interface AttributedRebuild {
  widget: string;
  root: string;
  count: number;
}

export interface BridgeRebuildCausesMessage {
  type: "rebuildCauses";
  available: boolean;
  windowMs: number;
  roots: RebuildCauseRoot[];
  attributed: AttributedRebuild[];
  message?: string;
}

export interface ErrorEntry {
  kind: string;
  signature: string;
  count: number;
  lastMessage?: string;
  route?: string;
  top: string[];
}

export interface BridgeErrorsMessage {
  type: "errors";
  available: boolean;
  total: number;
  errors: ErrorEntry[];
  message?: string;
}

export interface ImageCacheStats {
  currentSizeBytes: number;
  currentSize: number;
  maximumSizeBytes: number;
  live: number;
  pending: number;
}

export interface OversizedImage {
  source: string;
  decodedBytes: number;
  displayBytes: number;
  overheadBytes: number;
  count: number;
}

export interface BridgeImagesMessage {
  type: "images";
  available: boolean;
  cache: ImageCacheStats;
  oversized: OversizedImage[];
  message?: string;
}

export interface ProbeAvailability {
  rebuildProbe?: boolean;
  sourceLocations?: boolean;
  errors?: boolean;
  images?: boolean;
  leaks?: boolean;
  stalls?: boolean;
  deviceContext?: boolean;
}

export interface BridgeBuildInfoMessage {
  type: "buildInfo";
  buildMode: string;
  probes: ProbeAvailability;
}

export interface DeviceDisplayInfo {
  refreshRate?: number;
  budgetMs?: number;
  devicePixelRatio?: number;
  physicalWidth?: number;
  physicalHeight?: number;
}

export interface BridgeDeviceContextMessage {
  type: "deviceContext";
  available: boolean;
  platform?: string;
  buildMode?: string;
  locale?: string;
  textScale?: number;
  appPackage?: string;
  display?: DeviceDisplayInfo;
  extras?: Record<string, unknown>;
  message?: string;
}

export interface StallEntry {
  id: string;
  durationMs: number;
  atMs: number;
  route?: string;
}

export interface BridgeStallsMessage {
  type: "stalls";
  available: boolean;
  active?: boolean;
  thresholdMs?: number;
  total?: number;
  maxDurationMs?: number;
  stalls: StallEntry[];
  message?: string;
}

/** Flutter framework debug toggles (same as DevTools Inspector). */
export type DebugOptionId =
  | "performanceOverlay"
  | "debugPaint"
  | "debugPaintBaselines"
  | "repaintRainbow"
  | "invertOversizedImages"
  | "debugBanner"
  | "slowAnimations";

export interface DebugOptionState {
  id: DebugOptionId;
  enabled: boolean;
  available: boolean;
}

export interface BridgeDebugOptionsMessage {
  type: "debugOptions";
  options: DebugOptionState[];
  message?: string;
}

export type BridgeServerMessage =
  | BridgeStatusMessage
  | BridgeMetricsMessage
  | BridgeGcMessage
  | BridgeNetworkMessage
  | BridgeExtensionMessage
  | BridgeHotWidgetsMessage
  | BridgeDiscoverMessage
  | BridgeLogMessage
  | BridgeErrorMessage
  | BridgeCapabilitiesMessage
  | BridgeCpuProfileMessage
  | BridgeScenarioStatusMessage
  | BridgeMemoryProfileMessage
  | BridgeTimelineExportMessage
  | BridgeLeaksMessage
  | BridgeCpuExportMessage
  | BridgeRebuildCausesMessage
  | BridgeErrorsMessage
  | BridgeImagesMessage
  | BridgeBuildInfoMessage
  | BridgeDeviceContextMessage
  | BridgeStallsMessage
  | BridgeDebugOptionsMessage;

export type BridgeClientMessage =
  | { type: "connect"; url: string }
  | { type: "disconnect" }
  | { type: "mock" }
  | { type: "discover" }
  | { type: "refreshExtensions" }
  | { type: "stress"; action: string; params?: Record<string, unknown> }
  | { type: "hotWidgetsControl"; action: "freeze" | "unfreeze" | "reset" }
  | { type: "cpuRecord"; action: "start" | "stop"; durationMs?: number }
  | { type: "cpuExport"; durationMs?: number }
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
      type: "leakControl";
      action: "report" | "start" | "stop" | "reset";
      threshold?: number;
      limit?: number;
    }
  | {
      type: "debugOptions";
      action: "get" | "set";
      id?: DebugOptionId;
      enabled?: boolean;
    };
