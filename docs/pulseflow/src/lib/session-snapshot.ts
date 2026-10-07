/**
 * Serialize a PulseFlow "view" (verdict + problems + frozen hot widgets + sample
 * metrics) into a URL-safe hash so a teammate can open the exact same view.
 *
 * The snapshot is intentionally a *view* — not a full live session reconnect.
 * It lets someone inspect the ranked problems, the health verdict, and the
 * frozen rebuild ranks at the moment the link was created, without a running VM.
 */

import { buildProblems, computeBaselineMetrics } from "@/lib/problems";
import { computeVerdict } from "@/lib/verdict";
import type {
  HotWidgetsPayload,
  MetricPoint,
  PerformanceProblem,
  SessionBaseline,
} from "@/lib/types";

export interface ShareSnapshot {
  v: 1;
  /** "live" | "mock" | "shared" */
  mode: string;
  isolateName?: string;
  /** Lean metric points (sampled to keep the URL small). */
  points: MetricPoint[];
  problems: PerformanceProblem[];
  hot: HotWidgetsPayload | null;
  probeFrozen: boolean;
  baselines: SessionBaseline[];
  controlMessage?: string;
}

const MAX_POINTS = 60;
const MAX_WIDGETS = 20;

/**
 * Builds a shareable snapshot from the current live store view, sampling large
 * arrays so the resulting URL stays under ~8 KB.
 */
export function buildSnapshot(view: {
  mode?: "live" | "mock" | undefined;
  isolateName?: string;
  points: MetricPoint[];
  hot: HotWidgetsPayload | null;
  hotAvailable: boolean | null;
  gcEvents: Parameters<typeof buildProblems>[0]["gcEvents"];
  cpuProfile: Parameters<typeof buildProblems>[0]["cpuProfile"];
  memoryDiff: Parameters<typeof buildProblems>[0]["memoryDiff"];
  network: Parameters<typeof buildProblems>[0]["network"];
  scenarioResult: Parameters<typeof buildProblems>[0]["scenarioResult"];
  scenarioRunning: Parameters<typeof buildProblems>[0]["scenarioRunning"];
  probeFrozen: boolean;
  baselines: SessionBaseline[];
  controlMessage?: string;
}): ShareSnapshot {
  const latest = view.points.at(-1);
  const problems = buildProblems({
    hot: view.hot,
    hotAvailable: view.hotAvailable,
    latest,
    gcEvents: view.gcEvents,
    cpuProfile: view.cpuProfile,
    memoryDiff: view.memoryDiff,
    network: view.network,
    points: view.points,
    scenarioResult: view.scenarioResult,
    scenarioRunning: view.scenarioRunning,
  });

  const sampledHot = view.hot
    ? {
        ...view.hot,
        widgets: view.hot.widgets.slice(0, MAX_WIDGETS),
        screens: view.hot.screens.map((s) => ({
          ...s,
          topWidgets: s.topWidgets.slice(0, 5),
        })),
      }
    : null;

  return {
    v: 1,
    mode: view.mode ?? "live",
    isolateName: view.isolateName,
    points: view.points.slice(-MAX_POINTS).map((p) => ({
      t: p.t,
      cpu: p.cpu ?? 0,
      framePressure: p.framePressure ?? p.cpu ?? 0,
      frameMs: p.frameMs ?? 0,
      buildMs: p.buildMs ?? 0,
      rasterMs: p.rasterMs ?? 0,
      vsyncMs: p.vsyncMs ?? 0,
      jank: p.jank,
      heapMb: p.heapMb ?? 0,
      externalMb: p.externalMb ?? 0,
      refreshRate: p.refreshRate,
      buildBudgetMs: p.buildBudgetMs,
    })),
    problems,
    hot: sampledHot,
    probeFrozen: view.probeFrozen,
    baselines: view.baselines,
    controlMessage: view.controlMessage,
  };
}

/**
 * Re-derives the health verdict from a snapshot's points + problems, so a
 * shared link renders the same score/chips on `/problems` without a live app.
 */
export function verdictFromSnapshot(snap: ShareSnapshot) {
  return computeVerdict({
    points: snap.points,
    problems: snap.problems,
    budgetMs: snap.points.at(-1)?.buildBudgetMs,
  });
}

/** Reconstructs baselines (used for before/after comparison on `/history`). */
export function baselinesFromSnapshot(snap: ShareSnapshot): SessionBaseline[] {
  if (snap.baselines?.length) return snap.baselines;
  if (!snap.points.length) return [];
  const problemCount = snap.problems.length;
  return [computeBaselineMetrics({ points: snap.points, hot: snap.hot, problemCount, label: "shared" })];
}

const HASH_PREFIX = "s=";

/** base64-encode a UTF-8 string in a way that works in browsers and Node. */
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decodes a base64 string that was produced by `encodeBase64`. */
function decodeBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encodes a snapshot into a URL hash string: `#s=<base64json>`. */
export function snapshotToHash(snap: ShareSnapshot): string {
  const json = JSON.stringify(snap);
  const b64 = encodeBase64(json);
  return `#${HASH_PREFIX}${b64}`;
}

/** Reads a snapshot from `window.location.hash`, or `null` if absent/invalid. */
export function snapshotFromHash(hash: string): ShareSnapshot | null {
  try {
    const match = hash.match(/#s=([^&]+)/);
    if (!match) return null;
    const json = decodeBase64(match[1]);
    const obj = JSON.parse(json);
    if (obj && obj.v === 1) return obj as ShareSnapshot;
  } catch {
    return null;
  }
  return null;
}

/** True when the current location carries a shared snapshot. */
export function hasSharedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash.includes(HASH_PREFIX);
}

/**
 * Returns the current browser URL with the shared snapshot appended (stripping
 * any existing share hash first).
 */
export function shareableUrl(snap: ShareSnapshot): string {
  const hash = snapshotToHash(snap);
  const base = window.location.origin + window.location.pathname;
  return base + hash;
}
