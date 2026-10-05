"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PulseBridgeClient } from "@/lib/bridge-client";
import { normalizeHotWidgetsMessage } from "@/lib/normalize-hot";
import { buildProblems, computeBaselineMetrics } from "@/lib/problems";
import { downloadBase64 } from "@/lib/session-report";
import type {
  AttributedRebuild,
  BridgeHotWidgetsMessage,
  BridgeServerMessage,
  CapabilityMap,
  ConnectionStatus,
  CpuProfileSummary,
  DiscoveredApp,
  ErrorEntry,
  ExtensionInfo,
  GcEvent,
  HotWidgetsPayload,
  ImageCacheStats,
  LeakEntry,
  MemoryDiff,
  MemorySnapshot,
  MetricPoint,
  NetworkRequest,
  OversizedImage,
  RebuildCauseRoot,
  RetainingPathNode,
  ScenarioInfo,
  ScenarioResult,
  SessionBaseline,
  SocketSample,
  TimelineMarker,
} from "@/lib/types";

export interface RebuildCausesState {
  available: boolean;
  windowMs: number;
  roots: RebuildCauseRoot[];
  attributed: AttributedRebuild[];
}

export interface ImageStatsState {
  available: boolean;
  cache: ImageCacheStats;
  oversized: OversizedImage[];
}

const MAX_POINTS = 60;
const MAX_GC = 40;
const MAX_NET = 200;

export type ProblemsSnapshot = {
  hot: HotWidgetsPayload | null;
  hotAvailable: boolean | null;
  latest?: MetricPoint;
  gcEvents: GcEvent[];
  cpuProfile?: CpuProfileSummary | null;
  memoryDiff?: MemoryDiff | null;
  network?: NetworkRequest[];
  scenarioResult?: ScenarioResult | null;
  scenarioRunning?: string | null;
};

function emptyHot(partial?: Partial<HotWidgetsPayload>): HotWidgetsPayload {
  return {
    available: true,
    windowMs: 10000,
    totalRebuildsWindow: 0,
    totalRebuildsSession: 0,
    widgets: [],
    screens: [],
    frozen: false,
    ...partial,
  };
}

type PulseContextValue = {
  url: string;
  setUrl: (url: string) => void;
  bridgeReady: boolean;
  status: ConnectionStatus;
  mode: "live" | "mock" | undefined;
  statusMessage: string;
  isolateName?: string;
  error?: string;
  connected: boolean;
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
  isRecording: boolean;
  problemsSnapshot: ProblemsSnapshot | null;
  controlMessage?: string;
  capabilities: CapabilityMap | null;
  cpuProfile: CpuProfileSummary | null;
  cpuRecording: boolean;
  cpuMessage?: string;
  scenarios: ScenarioInfo[];
  scenarioRunning: string | null;
  scenarioResult: ScenarioResult | null;
  scenarioMessage?: string;
  memorySnapshots: MemorySnapshot[];
  memoryDiff: MemoryDiff | null;
  retainingPath: RetainingPathNode[] | null;
  memoryMessage?: string;
  timelineMarkers: TimelineMarker[];
  timelineMessage?: string;
  leaks: LeakEntry[];
  rebuildCauses: RebuildCausesState | null;
  appErrors: ErrorEntry[];
  images: ImageStatsState | null;
  baselines: SessionBaseline[];
  connect: (overrideUrl?: string) => void;
  disconnect: () => void;
  mock: () => void;
  discover: () => void;
  stress: (action: string, params?: Record<string, unknown>) => void;
  refreshExtensions: () => void;
  hotWidgetsControl: (action: "freeze" | "unfreeze" | "reset") => void;
  startCpuRecord: (durationMs?: number) => void;
  stopCpuRecord: () => void;
  exportCpu: (durationMs?: number) => void;
  listScenarios: () => void;
  runScenario: (id: string, params?: Record<string, unknown>) => void;
  stopScenario: () => void;
  captureMemorySnapshot: () => void;
  diffMemorySnapshots: () => void;
  requestRetainingPath: (classId?: string, objectId?: string) => void;
  exportTimeline: (durationMs?: number) => void;
  networkControl: (action: "refresh" | "clear" | "enable") => void;
  leakControl: (
    action: "report" | "start" | "stop" | "reset",
    opts?: { threshold?: number; limit?: number },
  ) => void;
  captureBaseline: (label: string) => void;
  clearBaselines: () => void;
};

const PulseContext = createContext<PulseContextValue | null>(null);

export function PulseProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState("ws://127.0.0.1:8181/ws");
  const [bridgeReady, setBridgeReady] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [mode, setMode] = useState<"live" | "mock" | undefined>();
  const [statusMessage, setStatusMessage] = useState("Starting bridge client…");
  const [isolateName, setIsolateName] = useState<string>();
  const [error, setError] = useState<string>();
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [gcEvents, setGcEvents] = useState<GcEvent[]>([]);
  const [network, setNetwork] = useState<NetworkRequest[]>([]);
  const [sockets, setSockets] = useState<SocketSample[]>([]);
  const [networkAvailable, setNetworkAvailable] = useState<boolean | null>(null);
  const [networkMessage, setNetworkMessage] = useState<string>();
  const [extension, setExtension] = useState<ExtensionInfo | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredApp[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [hot, setHot] = useState<HotWidgetsPayload | null>(null);
  const [hotAvailable, setHotAvailable] = useState<boolean | null>(null);
  const [hotMessage, setHotMessage] = useState<string>();
  const [probeFrozen, setProbeFrozen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [problemsSnapshot, setProblemsSnapshot] = useState<ProblemsSnapshot | null>(
    null,
  );
  const [controlMessage, setControlMessage] = useState<string>();
  const [capabilities, setCapabilities] = useState<CapabilityMap | null>(null);
  const [cpuProfile, setCpuProfile] = useState<CpuProfileSummary | null>(null);
  const [cpuRecording, setCpuRecording] = useState(false);
  const [cpuMessage, setCpuMessage] = useState<string>();
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenarioRunning, setScenarioRunning] = useState<string | null>(null);
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
  const [scenarioMessage, setScenarioMessage] = useState<string>();
  const [memorySnapshots, setMemorySnapshots] = useState<MemorySnapshot[]>([]);
  const [memoryDiff, setMemoryDiff] = useState<MemoryDiff | null>(null);
  const [retainingPath, setRetainingPath] = useState<RetainingPathNode[] | null>(null);
  const [memoryMessage, setMemoryMessage] = useState<string>();
  const [timelineMarkers, setTimelineMarkers] = useState<TimelineMarker[]>([]);
  const [timelineMessage, setTimelineMessage] = useState<string>();
  const [leaks, setLeaks] = useState<LeakEntry[]>([]);
  const [rebuildCauses, setRebuildCauses] = useState<RebuildCausesState | null>(null);
  const [appErrors, setAppErrors] = useState<ErrorEntry[]>([]);
  const [images, setImages] = useState<ImageStatsState | null>(null);
  const [baselines, setBaselines] = useState<SessionBaseline[]>([]);

  const clientRef = useRef<PulseBridgeClient | null>(null);
  const probeFrozenRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressHotUntilRef = useRef(0);
  const hotRef = useRef<HotWidgetsPayload | null>(null);
  const hotAvailableRef = useRef<boolean | null>(null);
  const pointsRef = useRef<MetricPoint[]>([]);
  const gcRef = useRef<GcEvent[]>([]);
  const cpuRef = useRef<CpuProfileSummary | null>(null);
  const memoryDiffRef = useRef<MemoryDiff | null>(null);
  const networkRef = useRef<NetworkRequest[]>([]);
  const scenarioResultRef = useRef<ScenarioResult | null>(null);
  const scenarioRunningRef = useRef<string | null>(null);

  const connected = status === "connected";

  useEffect(() => {
    hotRef.current = hot;
  }, [hot]);
  useEffect(() => {
    hotAvailableRef.current = hotAvailable;
  }, [hotAvailable]);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  useEffect(() => {
    gcRef.current = gcEvents;
  }, [gcEvents]);
  useEffect(() => {
    cpuRef.current = cpuProfile;
  }, [cpuProfile]);
  useEffect(() => {
    memoryDiffRef.current = memoryDiff;
  }, [memoryDiff]);
  useEffect(() => {
    networkRef.current = network;
  }, [network]);
  useEffect(() => {
    scenarioResultRef.current = scenarioResult;
  }, [scenarioResult]);
  useEffect(() => {
    scenarioRunningRef.current = scenarioRunning;
  }, [scenarioRunning]);

  const clearTelemetry = useCallback(() => {
    setPoints([]);
    setGcEvents([]);
    setNetwork([]);
    setSockets([]);
    setNetworkAvailable(null);
    setNetworkMessage(undefined);
    setExtension(null);
    setHot(null);
    setHotAvailable(null);
    setHotMessage(undefined);
    setProbeFrozen(false);
    probeFrozenRef.current = false;
    setIsRecording(false);
    suppressHotUntilRef.current = 0;
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setProblemsSnapshot(null);
    setControlMessage(undefined);
    setCapabilities(null);
    setCpuProfile(null);
    setCpuRecording(false);
    setCpuMessage(undefined);
    setScenarios([]);
    setScenarioRunning(null);
    setScenarioResult(null);
    setScenarioMessage(undefined);
    setMemorySnapshots([]);
    setMemoryDiff(null);
    setRetainingPath(null);
    setMemoryMessage(undefined);
    setTimelineMarkers([]);
    setTimelineMessage(undefined);
    setLeaks([]);
    setRebuildCauses(null);
    setAppErrors([]);
    setImages(null);
    setBaselines([]);
  }, []);

  const applyHot = useCallback((normalized: HotWidgetsPayload) => {
    setHotAvailable(normalized.available);
    setHot(normalized);
    if (normalized.message) setHotMessage(normalized.message);
    else if (normalized.available) setHotMessage(undefined);
  }, []);

  useEffect(() => {
    const client = new PulseBridgeClient({
      onOpen: () => {
        setBridgeReady(true);
        setStatusMessage("Bridge ready — scanning for local Flutter apps…");
        setDiscovering(true);
        try {
          client.send({ type: "discover" });
        } catch {
          setDiscovering(false);
        }
      },
      onClose: () => {
        setBridgeReady(false);
      },
      onError: () => {
        setError("Could not reach the PulseFlow bridge on port 3847");
      },
      onMessage: (msg: BridgeServerMessage) => {
        switch (msg.type) {
          case "status":
            setStatus(msg.status);
            setStatusMessage(msg.message ?? msg.status);
            if (msg.mode) setMode(msg.mode);
            if (msg.isolateName) setIsolateName(msg.isolateName);
            if (msg.status === "error") setError(msg.message);
            else if (msg.status === "connected" || msg.status === "idle") {
              setError(undefined);
            }
            if (msg.status === "disconnected" || msg.status === "idle") {
              probeFrozenRef.current = false;
              setProbeFrozen(false);
              setProblemsSnapshot(null);
            }
            break;
          case "metrics":
            setPoints((prev) => [...prev, msg.point].slice(-MAX_POINTS));
            break;
          case "gc":
            setGcEvents((prev) => [...prev, msg.event].slice(-MAX_GC));
            break;
          case "network":
            setNetworkAvailable(msg.available);
            if (msg.message) setNetworkMessage(msg.message);
            if (msg.requests) {
              setNetwork((prev) => {
                if (msg.requests!.length === 0) return [];
                const map = new Map(prev.map((r) => [r.id, r]));
                for (const r of msg.requests!) map.set(r.id, r);
                return [...map.values()].slice(-MAX_NET);
              });
            } else if (msg.request) {
              setNetwork((prev) => {
                const map = new Map(prev.map((r) => [r.id, r]));
                map.set(msg.request!.id, msg.request!);
                return [...map.values()].slice(-MAX_NET);
              });
            }
            if (msg.sockets) {
              setSockets(msg.sockets.slice(-40));
            }
            break;
          case "extension":
            setExtension(msg.info);
            break;
          case "hotWidgets": {
            const normalized = normalizeHotWidgetsMessage(msg as BridgeHotWidgetsMessage);
            if (probeFrozenRef.current && !normalized.frozen) {
              break;
            }
            if (
              Date.now() < suppressHotUntilRef.current &&
              !normalized.frozen &&
              (normalized.widgets?.length ?? 0) > 0
            ) {
              break;
            }
            if (normalized.frozen) {
              probeFrozenRef.current = true;
              setProbeFrozen(true);
            } else if (!probeFrozenRef.current) {
              setProbeFrozen(false);
            }
            applyHot(normalized);
            break;
          }
          case "discover":
            setDiscovered(msg.apps);
            setDiscovering(false);
            break;
          case "error":
            setError(msg.message);
            setDiscovering(false);
            break;
          case "capabilities":
            setCapabilities(msg.caps);
            break;
          case "cpuProfile":
            setCpuRecording(Boolean(msg.recording));
            if (msg.message) setCpuMessage(msg.message);
            if (msg.profile) setCpuProfile(msg.profile);
            if (msg.available === false && !msg.recording) {
              setCpuMessage(msg.message ?? "CPU profile unavailable");
            }
            break;
          case "scenarioStatus":
            if (msg.scenarios) setScenarios(msg.scenarios);
            if (msg.running !== undefined) setScenarioRunning(msg.running ?? null);
            if (msg.result) setScenarioResult(msg.result);
            if (msg.message) setScenarioMessage(msg.message);
            break;
          case "memoryProfile":
            if (msg.message) setMemoryMessage(msg.message);
            if (msg.snapshot) {
              setMemorySnapshots((prev) => {
                const next = [...prev.filter((s) => s.id !== msg.snapshot!.id), msg.snapshot!];
                return next.slice(-4);
              });
            }
            if (msg.diff) setMemoryDiff(msg.diff);
            if (msg.retainingPath) setRetainingPath(msg.retainingPath);
            break;
          case "timelineExport":
            if (msg.message) setTimelineMessage(msg.message);
            if (msg.markers) setTimelineMarkers(msg.markers);
            if (msg.available && msg.base64 && msg.fileName) {
              const mime =
                msg.format === "perfetto"
                  ? "application/octet-stream"
                  : "application/json";
              downloadBase64(msg.fileName, msg.base64, mime);
            }
            break;
          case "leaks":
            setLeaks(msg.available ? msg.leaked ?? [] : []);
            break;
          case "cpuExport":
            if (msg.message) setCpuMessage(msg.message);
            if (msg.available && msg.base64 && msg.fileName) {
              downloadBase64(msg.fileName, msg.base64, "application/json");
            }
            break;
          case "rebuildCauses":
            setRebuildCauses({
              available: msg.available,
              windowMs: msg.windowMs,
              roots: msg.roots ?? [],
              attributed: msg.attributed ?? [],
            });
            break;
          case "errors":
            setAppErrors(msg.available ? msg.errors ?? [] : []);
            break;
          case "images":
            setImages({
              available: msg.available,
              cache: msg.cache,
              oversized: msg.oversized ?? [],
            });
            break;
        }
      },
    });
    clientRef.current = client;
    client.connect();
    return () => client.dispose();
  }, [applyHot]);

  const send = useCallback((fn: () => void) => {
    try {
      fn();
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bridge command failed");
    }
  }, []);

  const connect = useCallback(
    (overrideUrl?: string) =>
      send(() => {
        const target = (overrideUrl ?? url).trim();
        if (overrideUrl) setUrl(target);
        clearTelemetry();
        clientRef.current?.send({ type: "connect", url: target });
      }),
    [clearTelemetry, send, url],
  );

  const disconnect = useCallback(
    () => send(() => clientRef.current?.send({ type: "disconnect" })),
    [send],
  );

  const mock = useCallback(
    () =>
      send(() => {
        clearTelemetry();
        clientRef.current?.send({ type: "mock" });
      }),
    [clearTelemetry, send],
  );

  const discover = useCallback(
    () =>
      send(() => {
        setDiscovering(true);
        setDiscovered([]);
        setError(undefined);
        clientRef.current?.send({ type: "discover" });
      }),
    [send],
  );

  const stress = useCallback(
    (action: string, params?: Record<string, unknown>) =>
      send(() => clientRef.current?.send({ type: "stress", action, params })),
    [send],
  );

  const refreshExtensions = useCallback(
    () => send(() => clientRef.current?.send({ type: "refreshExtensions" })),
    [send],
  );

  const hotWidgetsControl = useCallback(
    (action: "freeze" | "unfreeze" | "reset") => {
      send(() => {
        if (action === "freeze") {
          const snapHot = hotRef.current
            ? { ...hotRef.current, frozen: true }
            : emptyHot({ frozen: true, message: "Frozen" });
          probeFrozenRef.current = true;
          setProbeFrozen(true);
          setHot(snapHot);
          setProblemsSnapshot({
            hot: snapHot,
            hotAvailable: hotAvailableRef.current,
            latest: pointsRef.current.at(-1),
            gcEvents: [...gcRef.current],
            cpuProfile: cpuRef.current,
            memoryDiff: memoryDiffRef.current,
            network: [...networkRef.current],
            scenarioResult: scenarioResultRef.current,
            scenarioRunning: scenarioRunningRef.current,
          });
          setControlMessage("Frozen — rankings held still");
          setHotMessage(undefined);
        } else if (action === "unfreeze") {
          probeFrozenRef.current = false;
          setProbeFrozen(false);
          setProblemsSnapshot(null);
          setHot((prev) => (prev ? { ...prev, frozen: false } : prev));
          setControlMessage("Live sampling resumed");
        } else {
          probeFrozenRef.current = false;
          setProbeFrozen(false);
          setProblemsSnapshot(null);
          setPoints([]);
          setGcEvents([]);
          pointsRef.current = [];
          gcRef.current = [];
          const cleared = emptyHot({
            message: "Recording — interact with the app to fill new ranks",
          });
          setHot(cleared);
          setHotAvailable(true);
          setHotMessage(cleared.message);
          setIsRecording(true);
          setControlMessage("Recording — session cleared. New samples start now.");
          suppressHotUntilRef.current = Date.now() + 2500;
          if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
          recordingTimerRef.current = setTimeout(() => {
            setIsRecording(false);
            setControlMessage((prev) =>
              prev?.startsWith("Recording") ? "Recording window ended — live again" : prev,
            );
          }, 2500);
        }

        clientRef.current?.send({ type: "hotWidgetsControl", action });
      });
    },
    [send],
  );

  const startCpuRecord = useCallback(
    (durationMs = 5000) =>
      send(() =>
        clientRef.current?.send({ type: "cpuRecord", action: "start", durationMs }),
      ),
    [send],
  );

  const stopCpuRecord = useCallback(
    () => send(() => clientRef.current?.send({ type: "cpuRecord", action: "stop" })),
    [send],
  );

  const exportCpu = useCallback(
    (durationMs?: number) =>
      send(() => clientRef.current?.send({ type: "cpuExport", durationMs })),
    [send],
  );

  const listScenarios = useCallback(
    () => send(() => clientRef.current?.send({ type: "scenario", action: "list" })),
    [send],
  );

  const runScenario = useCallback(
    (id: string, params?: Record<string, unknown>) =>
      send(() =>
        clientRef.current?.send({ type: "scenario", action: "run", id, params }),
      ),
    [send],
  );

  const stopScenario = useCallback(
    () => send(() => clientRef.current?.send({ type: "scenario", action: "stop" })),
    [send],
  );

  const captureMemorySnapshot = useCallback(
    () =>
      send(() =>
        clientRef.current?.send({ type: "memorySnapshot", action: "capture" }),
      ),
    [send],
  );

  const diffMemorySnapshots = useCallback(
    () =>
      send(() => clientRef.current?.send({ type: "memorySnapshot", action: "diff" })),
    [send],
  );

  const requestRetainingPath = useCallback(
    (classId?: string, objectId?: string) =>
      send(() =>
        clientRef.current?.send({
          type: "memorySnapshot",
          action: "retainingPath",
          classId,
          objectId,
        }),
      ),
    [send],
  );

  const exportTimeline = useCallback(
    (durationMs = 5000) =>
      send(() =>
        clientRef.current?.send({
          type: "timelineExport",
          action: "perfetto",
          durationMs,
        }),
      ),
    [send],
  );

  const networkControl = useCallback(
    (action: "refresh" | "clear" | "enable") =>
      send(() => clientRef.current?.send({ type: "networkControl", action })),
    [send],
  );

  const leakControl = useCallback(
    (
      action: "report" | "start" | "stop" | "reset",
      opts?: { threshold?: number; limit?: number },
    ) =>
      send(() =>
        clientRef.current?.send({
          type: "leakControl",
          action,
          threshold: opts?.threshold,
          limit: opts?.limit,
        }),
      ),
    [send],
  );

  const captureBaseline = useCallback((label: string) => {
    const problemCount = buildProblems({
      hot: hotRef.current,
      hotAvailable: hotAvailableRef.current,
      latest: pointsRef.current.at(-1),
      gcEvents: [...gcRef.current],
      cpuProfile: cpuRef.current,
      memoryDiff: memoryDiffRef.current,
      network: [...networkRef.current],
      points: pointsRef.current,
      scenarioResult: scenarioResultRef.current,
      scenarioRunning: scenarioRunningRef.current,
    }).length;
    const baseline = computeBaselineMetrics({
      points: pointsRef.current,
      hot: hotRef.current,
      problemCount,
      label,
    });
    setBaselines((prev) => {
      const filtered = prev.filter((b) => b.label !== label);
      return [...filtered, baseline].slice(-6);
    });
  }, []);

  const clearBaselines = useCallback(() => setBaselines([]), []);

  const value = useMemo<PulseContextValue>(
    () => ({
      url,
      setUrl,
      bridgeReady,
      status,
      mode,
      statusMessage,
      isolateName,
      error,
      connected,
      points,
      gcEvents,
      network,
      sockets,
      networkAvailable,
      networkMessage,
      extension,
      discovered,
      discovering,
      hot,
      hotAvailable,
      hotMessage,
      probeFrozen,
      isRecording,
      problemsSnapshot,
      controlMessage,
      capabilities,
      cpuProfile,
      cpuRecording,
      cpuMessage,
      scenarios,
      scenarioRunning,
      scenarioResult,
      scenarioMessage,
      memorySnapshots,
      memoryDiff,
      retainingPath,
      memoryMessage,
      timelineMarkers,
      timelineMessage,
      leaks,
      rebuildCauses,
      appErrors,
      images,
      baselines,
      connect,
      disconnect,
      mock,
      discover,
      stress,
      refreshExtensions,
      hotWidgetsControl,
      startCpuRecord,
      stopCpuRecord,
      exportCpu,
      listScenarios,
      runScenario,
      stopScenario,
      captureMemorySnapshot,
      diffMemorySnapshots,
      requestRetainingPath,
      exportTimeline,
      networkControl,
      leakControl,
      captureBaseline,
      clearBaselines,
    }),
    [
      url,
      bridgeReady,
      status,
      mode,
      statusMessage,
      isolateName,
      error,
      connected,
      points,
      gcEvents,
      network,
      sockets,
      networkAvailable,
      networkMessage,
      extension,
      discovered,
      discovering,
      hot,
      hotAvailable,
      hotMessage,
      probeFrozen,
      isRecording,
      problemsSnapshot,
      controlMessage,
      capabilities,
      cpuProfile,
      cpuRecording,
      cpuMessage,
      scenarios,
      scenarioRunning,
      scenarioResult,
      scenarioMessage,
      memorySnapshots,
      memoryDiff,
      retainingPath,
      memoryMessage,
      timelineMarkers,
      timelineMessage,
      leaks,
      rebuildCauses,
      appErrors,
      images,
      baselines,
      connect,
      disconnect,
      mock,
      discover,
      stress,
      refreshExtensions,
      hotWidgetsControl,
      startCpuRecord,
      stopCpuRecord,
      exportCpu,
      listScenarios,
      runScenario,
      stopScenario,
      captureMemorySnapshot,
      diffMemorySnapshots,
      requestRetainingPath,
      exportTimeline,
      networkControl,
      leakControl,
      captureBaseline,
      clearBaselines,
    ],
  );

  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}

export function usePulse() {
  const ctx = useContext(PulseContext);
  if (!ctx) {
    throw new Error("usePulse must be used within PulseProvider");
  }
  return ctx;
}
