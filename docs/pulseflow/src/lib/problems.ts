import { isAppCpuFrame, tipForCpuHotspot } from "@/lib/cpu-profile";
import { FRAME_BUDGET } from "@/lib/chart-utils";
import { attachImpact, type ImpactContext } from "@/lib/impact";
import { explainProblem } from "@/lib/explain";
import type {
  AttributedRebuild,
  CpuProfileSummary,
  ErrorEntry,
  GcEvent,
  HotWidgetsPayload,
  MemoryDiff,
  MetricPoint,
  NetworkRequest,
  PerformanceProblem,
  ScenarioResult,
  WidgetRebuildStat,
} from "@/lib/types";

export function tipForWidget(
  name: string,
  share: number,
  ctx?: { ratePerSec?: number; duringJank?: boolean },
): string {
  const jankNote = ctx?.duringJank ? " It is rebuilding on janky frames — fix this first." : "";
  if (/ListView|GridView|Sliver/i.test(name)) {
    return `Keep the list virtualized; const/memo list items.${jankNote}`;
  }
  if (/StreamBuilder|FutureBuilder|Animated/i.test(name)) {
    return `Narrow listeners; push state lower in the tree.${jankNote}`;
  }
  if (/Painter|CustomPaint|Chart/i.test(name)) {
    return `Cache paint or wrap with RepaintBoundary.${jankNote}`;
  }
  if (share >= 25 || (ctx?.ratePerSec ?? 0) >= 15) {
    return `High rebuilds → isolate setState, use const, or split the widget.${jankNote}`;
  }
  return `Isolate rebuilds with const, keys, or a smaller StatefulWidget.${jankNote}`;
}

function hotRebuildProblem(
  w: WidgetRebuildStat,
  buildMs?: number,
  cause?: string,
): PerformanceProblem | null {
  if (w.isFramework) return null;
  if (w.ratePerSec < 8 && w.share < 20) return null;
  const severity: PerformanceProblem["severity"] =
    w.ratePerSec >= 15 || w.share >= 35 ? "high" : w.ratePerSec >= 8 || w.share >= 20 ? "medium" : "low";
  if (severity === "low") return null;
  const routeLabel =
    w.route && w.route !== "(unnamed)"
      ? ` on ${w.route}`
      : " on an unnamed route";
  const sourceLabel = w.sourceUri
    ? ` — ${w.sourceUri}${w.sourceLine ? `:${w.sourceLine}` : ""}`
    : "";
  const causeLabel = cause && cause !== w.name ? ` — triggered by ${cause}` : "";
  return {
    id: `hot_rebuild:${w.id}`,
    severity,
    kind: "hot_rebuild",
    title: `${w.name} rebuilds heavily${routeLabel}`,
    detail: `${w.ratePerSec.toFixed(1)}/s in the last window (${w.share.toFixed(1)}% of rebuilds)${sourceLabel}${causeLabel}`,
    action: tipForWidget(w.name, w.share, { ratePerSec: w.ratePerSec, duringJank: w.duringJank }),
    route: w.route,
    widget: w.name,
    ratePerSec: w.ratePerSec,
    share: w.share,
    relatedBuildMs: buildMs,
    sourceUri: w.sourceUri,
    sourceLine: w.sourceLine,
    cause: cause && cause !== w.name ? cause : undefined,
    duringJank: w.duringJank,
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function buildProblems(input: {
  hot: HotWidgetsPayload | null;
  hotAvailable: boolean | null;
  latest?: MetricPoint;
  gcEvents: GcEvent[];
  cpuProfile?: CpuProfileSummary | null;
  memoryDiff?: MemoryDiff | null;
  network?: NetworkRequest[];
  points?: MetricPoint[];
  scenarioResult?: ScenarioResult | null;
  scenarioRunning?: string | null;
  rebuildCauses?: { attributed: AttributedRebuild[] } | null;
  errors?: ErrorEntry[] | null;
}): PerformanceProblem[] {
  const {
    hot,
    hotAvailable,
    latest,
    gcEvents,
    cpuProfile,
    memoryDiff,
    network = [],
    points = [],
    scenarioResult,
    scenarioRunning,
    rebuildCauses,
    errors,
  } = input;
  const problems: PerformanceProblem[] = [];

  if (hotAvailable === false) {
    problems.push({
      id: "missing_probe",
      severity: "high",
      kind: "missing_probe",
      title: "Widget probe not available",
      detail: "Without the PulseFlow extension, rebuild ranks and screen tips stay empty.",
      action:
        "Copy examples/pulseflow_extension.dart into the app, call registerPulseFlowExtensions(), hot-restart, then Connect again.",
    });
  }

  const buildMs = latest?.buildMs ?? 0;
  const rasterMs = latest?.rasterMs ?? 0;
  const budgetMs = latest?.buildBudgetMs ?? FRAME_BUDGET;

  if (buildMs > budgetMs * 0.5) {
    problems.push({
      id: "high_build",
      severity: buildMs > budgetMs * 0.75 ? "high" : "medium",
      kind: "high_build",
      title: "Build time is over budget",
      detail: `Latest Build ${buildMs.toFixed(1)} ms (${budgetMs.toFixed(1)} ms frame budget).`,
      action:
        "Focus on top rebuild widgets — limit setState scope, prefer const, split large widgets.",
      relatedBuildMs: buildMs,
    });
  }

  if (rasterMs > budgetMs * 0.5) {
    problems.push({
      id: "high_raster",
      severity: rasterMs > budgetMs * 0.75 ? "high" : "medium",
      kind: "high_raster",
      title: "Raster time is expensive",
      detail: `Latest Raster ${rasterMs.toFixed(1)} ms — paint/compositing is heavy.`,
      action:
        "Cut shadows, blur, opacity on large layers, and heavy images; wrap with RepaintBoundary.",
      relatedBuildMs: rasterMs,
    });
  }

  if (gcEvents.length >= 6) {
    problems.push({
      id: "gc_pressure",
      severity: "medium",
      kind: "gc_pressure",
      title: "Frequent garbage collection",
      detail: `${gcEvents.length} GC events in the recent buffer.`,
      action: "Reduce short-lived allocations (temp lists, image decode, large string builds).",
    });
  }

  if (hot?.available && hot.widgets.length) {
    const causeByWidget = new Map(
      (rebuildCauses?.attributed ?? []).map((a) => [a.widget, a.root]),
    );
    for (const w of hot.widgets) {
      const p = hotRebuildProblem(w, buildMs, causeByWidget.get(w.name));
      if (p) problems.push(p);
    }
  }

  if (cpuProfile?.topFunctions?.length) {
    for (const fn of cpuProfile.topFunctions.slice(0, 5)) {
      if (!isAppCpuFrame(fn.qualifiedName) && fn.selfPercent < 20) continue;
      if (fn.selfPercent < 8) continue;
      problems.push({
        id: `cpu_hotspot:${fn.qualifiedName}`,
        severity: fn.selfPercent >= 15 ? "high" : "medium",
        kind: "cpu_hotspot",
        title: `CPU hotspot: ${fn.name}`,
        detail: `${fn.selfPercent.toFixed(1)}% self · ${fn.totalPercent.toFixed(1)}% total (${fn.qualifiedName})`,
        action: tipForCpuHotspot(fn),
        ratePerSec: fn.selfPercent,
      });
    }
  }

  const recent = points.slice(-20);
  const jankRatio =
    recent.length > 0 ? recent.filter((p) => p.jank).length / recent.length : 0;
  if (
    (scenarioRunning || scenarioResult?.ok) &&
    jankRatio >= 0.35 &&
    recent.length >= 6
  ) {
    const id = scenarioRunning ?? scenarioResult?.id ?? "scenario";
    problems.push({
      id: `scenario_jank:${id}`,
      severity: jankRatio >= 0.55 ? "high" : "medium",
      kind: "scenario_jank",
      title: `Scenario exposed frame jank (${id})`,
      detail: `${Math.round(jankRatio * 100)}% of recent frames missed the 16.67 ms budget.`,
      action:
        "Fix top rebuild/CPU items first, then re-run the same scenario to compare baselines.",
    });
  }

  if (memoryDiff?.grew?.length) {
    const top = memoryDiff.grew[0]!;
    if (top.bytesDelta >= 512 * 1024) {
      problems.push({
        id: `memory_growth:${top.className}`,
        severity: top.bytesDelta >= 4 * 1024 * 1024 ? "high" : "medium",
        kind: "memory_growth",
        title: `Memory grew: ${top.className}`,
        detail: `+${(top.bytesDelta / (1024 * 1024)).toFixed(2)} MB · +${top.instancesDelta} instances between snapshots.`,
        action:
          "Check retainers for this class; clear caches, dispose controllers, and avoid unbounded lists.",
      });
    }
  }

  const slow = [...network]
    .filter((r) => r.latencyMs >= 500)
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, 3);
  for (const r of slow) {
    problems.push({
      id: `slow_http:${r.method}:${r.uri}`,
      severity: r.latencyMs >= 1500 ? "high" : "medium",
      kind: "slow_http",
      title: `Slow HTTP ${r.method} ${r.uri}`,
      detail: `${r.latencyMs.toFixed(0)} ms · status ${r.status ?? "—"}`,
      action: "Cache responses, paginate payloads, or move work off the critical path.",
      ratePerSec: r.latencyMs,
    });
  }

  for (const e of errors ?? []) {
    if (e.count < 1) continue;
    const isOverflow = e.kind === "overflow";
    const isAssert = e.kind === "assert";
    problems.push({
      id: `error:${e.kind}:${e.signature}`,
      severity: isOverflow || isAssert ? "high" : "medium",
      kind: isOverflow ? "error_overflow" : "error_exception",
      title: `${isOverflow ? "Overflow" : isAssert ? "Assertion" : "Error"}: ${e.signature}`,
      detail: `${e.count}× ${e.kind}${e.route ? ` on ${e.route}` : ""}`,
      action: isOverflow
        ? "Wrap the overflowing row/column in Expanded/Flexible or a scroll view."
        : "Fix the exception; expand the stack frames for the source.",
      route: e.route,
      ratePerSec: e.count,
    });
  }

  const ctx: ImpactContext = { budgetMs, jankRatio };
  const ranked = attachImpact(problems, ctx);
  for (const p of ranked) p.why = explainProblem(p, ctx);

  return ranked.slice(0, 8);
}

export function computeBaselineMetrics(input: {
  points: MetricPoint[];
  hot: HotWidgetsPayload | null;
  problemCount: number;
  label: string;
}): {
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
} {
  const builds = input.points.map((p) => p.buildMs);
  const rasters = input.points.map((p) => p.rasterMs);
  const frames = input.points.map((p) => p.frameMs);
  const jankRatio =
    input.points.length > 0
      ? input.points.filter((p) => p.jank).length / input.points.length
      : 0;
  return {
    id: `${Date.now()}-${input.label}`,
    label: input.label,
    t: Date.now(),
    p95BuildMs: Number(percentile(builds, 95).toFixed(2)),
    p95RasterMs: Number(percentile(rasters, 95).toFixed(2)),
    p95FrameMs: Number(percentile(frames, 95).toFixed(2)),
    rebuildRate: input.hot?.widgets?.[0]?.ratePerSec ?? 0,
    heapMb: Number((input.points.at(-1)?.heapMb ?? 0).toFixed(2)),
    jankRatio: Number(jankRatio.toFixed(3)),
    problemCount: input.problemCount,
  };
}
