/**
 * Per-section context builders + prompts for the AI drawer.
 *
 * Pure module (no React, no node:fs): it turns the same data the dashboard already
 * renders into a compact Markdown brief for the model, reusing `buildProblems`,
 * `computeVerdict`, and `buildAgentReportMarkdown` instead of re-deriving anything.
 */
import { buildAgentReportMarkdown } from "@/lib/agent-report";
import { isFrameworkWidget } from "@/lib/framework-widget";
import { computeVerdict, type BudgetResult } from "@/lib/verdict";
import { formatBytes } from "@/lib/utils";
import { compareByHeatThenName, widgetHeat } from "@/lib/widget-heat";
import type { AiLanguage } from "@/lib/ai-providers";
import type {
  CpuProfileSummary,
  DeviceDisplayInfo,
  ErrorEntry,
  HotWidgetsPayload,
  ImageCacheStats,
  LeakEntry,
  MemoryDiff,
  MetricPoint,
  NetworkRequest,
  OversizedImage,
  PerformanceProblem,
  ProbeAvailability,
  StallEntry,
} from "@/lib/types";

export type AiSection =
  | "problems"
  | "widgets"
  | "frames"
  | "device"
  | "cpu"
  | "memory"
  | "network"
  | "report";

export interface AiDeviceContext {
  available: boolean;
  platform?: string;
  buildMode?: string;
  locale?: string;
  textScale?: number;
  appPackage?: string;
  display?: DeviceDisplayInfo;
  extras?: Record<string, unknown>;
}

export interface AiStallsContext {
  available: boolean;
  thresholdMs?: number;
  total: number;
  maxDurationMs: number;
  stalls: StallEntry[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiImageStats {
  available: boolean;
  cache: ImageCacheStats;
  oversized: OversizedImage[];
}

export interface AiContextState {
  mode?: "live" | "mock";
  points: MetricPoint[];
  problems: PerformanceProblem[];
  budgetMs?: number;
  hot?: HotWidgetsPayload | null;
  cpuProfile?: CpuProfileSummary | null;
  memoryDiff?: MemoryDiff | null;
  leaks?: LeakEntry[];
  images?: AiImageStats | null;
  network?: NetworkRequest[];
  errors?: ErrorEntry[];
  buildInfo?: { buildMode: string; probes: ProbeAvailability } | null;
  deviceContext?: AiDeviceContext | null;
  stalls?: AiStallsContext | null;
}

export const SECTION_TITLES: Record<AiSection, string> = {
  problems: "Problems",
  widgets: "Widgets",
  frames: "Frames",
  device: "Device",
  cpu: "CPU",
  memory: "Memory",
  network: "Network",
  report: "Report",
};

const SECTION_HINTS: Record<AiSection, string> = {
  problems:
    "the ranked Problems list and session health — cover every track present in the brief (frame, network, memory, errors, stalls)",
  widgets:
    "per-widget rebuild problems on the current screen only: problem count/severity, rebuild rate, share, source, and cause — prioritize the reddest widgets. Do not review HTTP, CPU profiles, heap, or other tabs",
  frames:
    "frame timing (build/raster/jank) against the frame budget, UI stalls when listed, and frame-track problems — tie to hot widgets when listed. Do not review HTTP latency or heap/leaks",
  device:
    "device/platform/display context and UI stall evidence only. Do not review HTTP, CPU profiles, or heap",
  cpu: "CPU hotspots by self-time and cpu_hotspot problems — tie to rebuild cost only when widget evidence is in the brief. Do not review HTTP or memory",
  memory: "heap growth, leaks, and image-cache waste only. Do not review rebuilds, frames, or HTTP",
  network:
    "slow HTTP requests (latency / UX wait) only. Do not claim latency equals build ms, and do not review widget rebuilds or frame budgets as the main topic",
  report: "the whole session across performance, widgets, CPU, memory, network, and device/stalls",
};

const MAX = {
  problems: 12,
  widgets: 12,
  cpu: 12,
  http: 10,
  memory: 10,
  images: 10,
  errors: 10,
} as const;

export const QUICK_PROMPTS = {
  explain:
    "Write a concise review: short summary, up to 5 findings with app widget + route, up to 3 ranked fixes, and what to re-measure. Separate frame-budget issues from network latency.",
  topFixes:
    "Give the top 3 fixes by impact. Name each app widget and its route/screen, with concrete Flutter steps. Do not invent libraries.",
  regression:
    "Is anything regressing? Name the widgets/routes to watch and what metric should improve after a fix.",
} as const;

export const SECTION_QUICK_PROMPTS: Record<AiSection, readonly string[]> = {
  problems: Object.values(QUICK_PROMPTS),
  widgets: [
    "Review the widgets with the most problems on this screen. For each, cite problem count, severity, rebuild rate, and a concrete Flutter fix.",
    "Rank the hottest widgets on the current route by impact and tell me which to fix first.",
    "Which rebuilds here are expected (scroll/animation) vs real bugs? Separate noise from actionable widget problems.",
  ],
  frames: [
    "Are we over the frame budget? Cite P95 build/raster and jank, then the frame problems to fix first.",
    "Which screens/widgets in this brief drive build or jank cost?",
    "What should I re-measure on the Frames tab after a fix?",
  ],
  device: [
    "Summarize platform, display budget, and any UI stalls. What should I check first on Device?",
    "Do text scale or refresh rate help explain frame budget pressure?",
    "If stalls are present, what main-isolate work should I investigate?",
  ],
  cpu: [
    "Which CPU hotspots matter most by self-time? Give concrete Flutter/Dart fixes.",
    "Do any hotspots look like UI rebuild cost? Only cite widgets listed in the brief.",
    "What should I re-profile on the CPU tab after a fix?",
  ],
  memory: [
    "Summarize heap growth, leaks, and image-cache waste. Rank fixes by measured bytes.",
    "Which classes or images should I investigate first?",
    "What should I re-measure on the Memory tab after a fix?",
  ],
  network: [
    "Rank the slowest HTTP requests by latency and suggest UX/network fixes (cache, pagination, loading states).",
    "Which requests are over 1.5s? What should change first?",
    "What should I re-measure on the Network tab after a fix?",
  ],
  report: Object.values(QUICK_PROMPTS),
};

const SECTION_DEFAULT_QUESTION: Record<AiSection, string> = {
  problems:
    "Review the ranked problems for this session. Separate frame-budget issues from network latency and memory. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  widgets:
    "Stay on the Widgets view: rebuild pressure and widget problems on this screen only. Rank by problem count and rebuild rate/share. For each hot widget name the route, measured evidence, and a concrete Flutter fix. If no widgets have problems or meaningful rebuild rate, say this screen is quiet for rebuilds and stop — do not invent HTTP findings, network fixes, or widget names. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  frames:
    "Stay on the Frames view: P95 build/raster, jank, stalls when listed, and frame-track problems only. Tie findings to hot widgets only when they appear in the brief. Do not discuss HTTP latency or memory leaks. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  device:
    "Stay on the Device view: platform/display/locale and UI stall evidence only. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  cpu: "Stay on the CPU view: hotspot self-time and cpu_hotspot problems only. Mention widgets only if listed in the brief. Do not discuss HTTP or heap. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  memory:
    "Stay on the Memory view: heap growth, leaks, and image cache only. Do not discuss rebuilds, frames, or HTTP. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  network:
    "Stay on the Network view: HTTP latency and slow requests only. Do not discuss widget rebuilds, frame budgets, or CPU. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
  report:
    "Write a concise whole-session review. Separate frame-budget, network, and memory tracks. Cap Findings at 5 and Fixes at 3. Do not invent numbers, libraries, or file paths.",
};

export function sectionFromPath(pathname: string): AiSection {
  const clean = pathname.replace(/\/+$/, "");
  if (clean.startsWith("/widgets")) return "widgets";
  if (clean.startsWith("/frames")) return "frames";
  if (clean.startsWith("/device")) return "device";
  if (clean.startsWith("/cpu")) return "cpu";
  if (clean.startsWith("/memory")) return "memory";
  if (clean.startsWith("/network")) return "network";
  if (clean.startsWith("/report")) return "report";
  return "problems";
}

function budgetText(b: BudgetResult): string {
  if (b.unit === "ratio") return `${(b.value * 100).toFixed(0)}%/${(b.budget * 100).toFixed(0)}%`;
  return `${b.value.toFixed(1)}/${b.budget.toFixed(1)}ms`;
}

function sessionBlock(
  state: AiContextState,
  opts?: {
    /** Subset of problems that should drive the verdict (e.g. frame-only on Widgets). */
    problems?: PerformanceProblem[];
    /** Heading when the brief is scoped away from whole-session issues. */
    title?: string;
    note?: string;
    /** Frame budget chips — omit on Network/Memory so the model does not pivot. */
    includeBudgets?: boolean;
  },
): string {
  const includeBudgets = opts?.includeBudgets !== false;
  const verdict = computeVerdict({
    points: includeBudgets ? state.points : [],
    problems: opts?.problems ?? state.problems,
    budgetMs: state.budgetMs,
  });
  const lines = [
    `## ${opts?.title ?? "Session health"}`,
    `- Verdict: **${verdict.status}** (score ${verdict.score}/100)`,
    `- ${verdict.headline}`,
  ];
  if (includeBudgets) {
    lines.push(
      `- Budgets: ${verdict.budgets
        .map((b) => `${b.label} ${budgetText(b)} ${b.passed ? "ok" : "OVER"}`)
        .join(" · ")}`,
    );
  }
  lines.push(`- Mode: ${state.mode ?? "unknown"}`);
  if (opts?.note) lines.push(`- ${opts.note}`);
  return lines.join("\n");
}

function trackOf(kind: PerformanceProblem["kind"]): "frame" | "network" | "memory" | "other" {
  switch (kind) {
    case "slow_http":
      return "network";
    case "memory_growth":
    case "gc_pressure":
      return "memory";
    case "hot_rebuild":
    case "high_build":
    case "high_raster":
    case "cpu_hotspot":
    case "scenario_jank":
    case "ui_stall":
      return "frame";
    default:
      return "other";
  }
}

function problemsOnTrack(
  problems: PerformanceProblem[],
  track: "frame" | "network" | "memory",
): PerformanceProblem[] {
  return problems.filter((p) => trackOf(p.kind) === track);
}

function cpuProblems(problems: PerformanceProblem[]): PerformanceProblem[] {
  return problems.filter((p) => p.kind === "cpu_hotspot");
}

/** Scoped problems heading — reuse ranking lines without the global Problems title. */
function scopedProblemsBlock(
  title: string,
  problems: PerformanceProblem[],
  emptyNote: string,
): string {
  if (!problems.length) return `## ${title}\n_${emptyNote}_`;
  return problemsBlock(problems).replace("## Problems (ranked by impact)", `## ${title}`);
}

function problemsBlock(problems: PerformanceProblem[]): string {
  if (!problems.length) return "## Problems (ranked)\n_none detected in this session_";
  const lines = [
    "## Problems (ranked by impact)",
    "_Tracks: **frame** = build/raster/jank/rebuilds; **network** = HTTP latency (UX wait, not frame cost by itself)._",
  ];
  problems.slice(0, MAX.problems).forEach((p, i) => {
    const impact = p.impact != null ? ` (impact ${p.impact})` : "";
    const track = trackOf(p.kind);
    const widgetAt =
      p.widget && p.route
        ? ` — \`${p.widget}\` on ${p.route}`
        : p.widget
          ? ` — \`${p.widget}\``
          : p.route
            ? ` — route ${p.route}`
            : "";
    lines.push(
      `${i + 1}. **[${p.severity.toUpperCase()}/${track}] ${p.title}**${widgetAt}${impact}`,
    );
    if (p.why) lines.push(`   - Why: ${p.why}`);
    lines.push(`   - Fix: ${p.action}`);
    const where = [
      p.sourceUri ? `${p.sourceUri}${p.sourceLine ? `:${p.sourceLine}` : ""}` : "",
      p.cause ? `cause: ${p.cause}` : "",
      p.latencyMs != null ? `${p.latencyMs.toFixed(0)} ms latency` : "",
      p.kind !== "slow_http" && p.ratePerSec != null ? `${p.ratePerSec.toFixed(1)}/s` : "",
      p.share != null ? `${p.share.toFixed(1)}% share` : "",
      p.relatedBuildMs != null ? `relatedBuild ${p.relatedBuildMs.toFixed(1)} ms` : "",
      p.duringJank ? "during jank" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (where) lines.push(`   - Evidence: ${where}`);
  });
  return lines.join("\n");
}

function errorsBlock(errors?: ErrorEntry[]): string {
  if (!errors?.length) return "## Errors\n_none captured_";
  return [
    "## Errors",
    ...errors.slice(0, MAX.errors).map(
      (e) => `- ${e.kind.toUpperCase()} ×${e.count}${e.route ? ` on ${e.route}` : ""} — ${e.signature}`,
    ),
  ].join("\n");
}

function formatWidgetLine(
  w: {
    name: string;
    route: string;
    ratePerSec: number;
    share: number;
    keyLabel?: string;
    sourceUri?: string;
    sourceLine?: number;
    cause?: string;
    duringJank?: boolean;
    isFramework?: boolean;
  },
  heat?: { count: number; maxSeverity: PerformanceProblem["severity"] | null; score: number },
): string {
  const parts = [
    `\`${w.name}\` on ${w.route}`,
    `${w.ratePerSec.toFixed(1)}/s`,
    `${w.share.toFixed(1)}% share`,
  ];
  if (heat && heat.count > 0) {
    parts.push(
      `${heat.count} problem${heat.count === 1 ? "" : "s"}${heat.maxSeverity ? ` (${heat.maxSeverity})` : ""}`,
    );
  } else if (heat?.maxSeverity) {
    parts.push(`pressure ${heat.maxSeverity}`);
  }
  if (w.keyLabel) parts.push(`key ${w.keyLabel}`);
  if (w.sourceUri) parts.push(`${w.sourceUri}${w.sourceLine ? `:${w.sourceLine}` : ""}`);
  if (w.cause) parts.push(`cause ${w.cause}`);
  if (w.duringJank) parts.push("during jank");
  if (w.isFramework || isFrameworkWidget(w)) parts.push("framework — ignore unless rebuild root");
  return `- ${parts.join(" · ")}`;
}

function widgetsBlock(
  hot?: HotWidgetsPayload | null,
  opts?: {
    appOnly?: boolean;
    /** Prefer widgets on hot.currentRoute (Widgets page / AI focus). */
    currentRouteOnly?: boolean;
    problems?: PerformanceProblem[];
  },
): string {
  const raw = hot?.widgets ?? [];
  let widgets = opts?.appOnly ? raw.filter((w) => !isFrameworkWidget(w)) : raw;
  if (opts?.currentRouteOnly && hot?.currentRoute) {
    const onRoute = widgets.filter((w) => w.route === hot.currentRoute);
    if (onRoute.length) widgets = onRoute;
  }
  // Drop near-idle rows so the model cannot invent "HIGH" from 0.1–1.0/s shells —
  // unless they already carry a matched problem.
  if (opts?.appOnly) {
    widgets = widgets.filter((w) => {
      const heat = widgetHeat(w, opts.problems ?? []);
      return heat.count > 0 || w.ratePerSec >= 3 || w.share >= 8;
    });
  }
  const ranked = widgets
    .map((w) => ({ w, heat: widgetHeat(w, opts?.problems ?? []) }))
    .sort((a, b) =>
      compareByHeatThenName({ heat: a.heat, name: a.w.name }, { heat: b.heat, name: b.w.name }),
    );
  if (!ranked.length) {
    return opts?.appOnly && raw.length
      ? "## App widget rebuilds\n_no meaningful app rebuild rate in this window; use screen totals below_"
      : "## Widget rebuilds\n_no widget data (probe may be missing)_";
  }
  const lines = [
    `## ${opts?.appOnly ? "App widget" : "Widget"} rebuilds (window ${((hot?.windowMs ?? 10000) / 1000).toFixed(0)}s)`,
    "_Cite as `WidgetName` on `/route` (file:line when shown). Prefer widgets with problems / high heat. Skip framework shells. Widgets under ~3/s without problems are not primary causes of 100ms+ build._",
  ];
  if (hot?.currentRoute) {
    lines.push(`- Current route/screen: **${hot.currentRoute}**`);
  }
  lines.push(
    ...ranked.slice(0, MAX.widgets).map(({ w, heat }) => formatWidgetLine(w, heat)),
  );
  const screens = hot?.screens ?? [];
  if (screens.length && !opts?.currentRouteOnly) {
    lines.push("", "### By screen / route (strongest scroll/interaction signal)");
    for (const s of screens.slice(0, 8)) {
      const tops = (s.topWidgets ?? [])
        .filter((w) => !opts?.appOnly || !isFrameworkWidget(w))
        .filter((w) => w.ratePerSec >= 3 || w.share >= 8)
        .slice(0, 3)
        .map((w) => `\`${w.name}\``)
        .join(", ");
      lines.push(
        `- ${s.route} — ${s.ratePerSec.toFixed(1)}/s (${s.share.toFixed(1)}%)${
          tops ? ` · top: ${tops}` : ""
        }`,
      );
    }
  }
  return lines.join("\n");
}

/** Problems that name a widget (or screen rebuild pressure) — for the Widgets AI brief. */
function widgetProblemsBlock(problems: PerformanceProblem[], currentRoute?: string): string {
  let list = problems.filter(
    (p) =>
      Boolean(p.widget) ||
      p.kind === "hot_rebuild" ||
      p.kind === "high_build" ||
      p.kind === "high_raster" ||
      p.kind === "scenario_jank",
  );
  if (currentRoute) {
    const onRoute = list.filter((p) => !p.route || p.route === currentRoute);
    if (onRoute.length) list = onRoute;
  }
  if (!list.length) {
    return "## Widget problems on this screen\n_none ranked yet — interact with the UI or wait for rebuild pressure_";
  }
  // Reuse ranking lines from problemsBlock, but keep a Widgets-page heading.
  return problemsBlock(list).replace(
    "## Problems (ranked by impact)",
    "## Widget problems on this screen (ranked by impact)",
  );
}

function framesBlock(state: AiContextState): string {
  const point = state.points.at(-1);
  const verdict = computeVerdict({
    points: state.points,
    problems: [],
    budgetMs: state.budgetMs,
  });
  const b = (key: string) => verdict.budgets.find((x) => x.key === key);
  const lines = ["## Frames (frame-budget track)"];
  const build = b("p95Build");
  const raster = b("p95Raster");
  const jank = b("jank");
  if (build) lines.push(`- P95 build: ${build.value.toFixed(1)} ms (budget ${build.budget.toFixed(1)} ms)`);
  if (raster) lines.push(`- P95 raster: ${raster.value.toFixed(1)} ms (budget ${raster.budget.toFixed(1)} ms)`);
  if (jank) lines.push(`- Jank ratio: ${(jank.value * 100).toFixed(0)}% (limit ${(jank.budget * 100).toFixed(0)}%)`);
  lines.push(`- Samples: ${state.points.length}`);
  if (point) {
    lines.push(`- Latest frame: ${point.frameMs.toFixed(1)} ms`);
    if (point.refreshRate) lines.push(`- Display: ${point.refreshRate} Hz`);
  }
  return lines.join("\n");
}

function deviceBlock(state: AiContextState): string {
  const d = state.deviceContext;
  if (!d?.available) {
    return "## Device context\n_device context unavailable (pulseflow_flutter ≥ 0.2 / getDeviceContext)_";
  }
  const lines = [
    "## Device context",
    `- Platform: ${d.platform ?? "—"}`,
    `- Build mode: ${d.buildMode ?? "—"}`,
    `- Locale: ${d.locale ?? "—"}`,
    `- Text scale: ${d.textScale != null ? d.textScale.toFixed(2) : "—"}`,
    `- App package: ${d.appPackage ?? "—"}`,
  ];
  const display = d.display;
  if (display) {
    if (display.refreshRate != null) lines.push(`- Refresh rate: ${display.refreshRate} Hz`);
    if (display.budgetMs != null) lines.push(`- Frame budget: ${display.budgetMs.toFixed(2)} ms`);
    if (display.devicePixelRatio != null) {
      lines.push(`- DPR: ${display.devicePixelRatio.toFixed(2)}`);
    }
    if (display.physicalWidth != null && display.physicalHeight != null) {
      lines.push(
        `- Physical size: ${Math.round(display.physicalWidth)}×${Math.round(display.physicalHeight)}`,
      );
    }
  }
  const extras = d.extras ? Object.entries(d.extras).filter(([, v]) => v != null) : [];
  if (extras.length) {
    lines.push(
      `- Extras: ${extras
        .slice(0, 8)
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

function stallsBlock(state: AiContextState): string {
  const s = state.stalls;
  if (!s?.available) {
    return "## UI stalls\n_stall probe unavailable_";
  }
  if (s.total <= 0) {
    return `## UI stalls\n_none over ${s.thresholdMs ?? 250} ms threshold_`;
  }
  const routes = [
    ...new Set(s.stalls.map((e) => e.route).filter((r): r is string => Boolean(r))),
  ].slice(0, 4);
  const lines = [
    "## UI stalls (main-isolate freeze)",
    `- Total: ${s.total} · max ${s.maxDurationMs.toFixed(0)} ms · threshold ${s.thresholdMs ?? 250} ms`,
  ];
  if (routes.length) lines.push(`- Last routes: ${routes.join(", ")}`);
  for (const e of s.stalls.slice(-5)) {
    lines.push(
      `- ${e.durationMs.toFixed(0)} ms${e.route ? ` on ${e.route}` : ""} @ ${new Date(e.atMs).toISOString()}`,
    );
  }
  return lines.join("\n");
}

function cpuBlock(profile?: CpuProfileSummary | null): string {
  if (!profile?.topFunctions?.length) return "## CPU hotspots\n_no CPU profile captured_";
  return [
    `## CPU hotspots (${(profile.durationMs / 1000).toFixed(1)}s, ${profile.sampleCount} samples)`,
    ...profile.topFunctions
      .slice(0, MAX.cpu)
      .map((f) => `- \`${f.qualifiedName}\` — ${f.selfPercent}% self / ${f.totalPercent}% total`),
  ].join("\n");
}

function memoryBlock(state: AiContextState): string {
  const lines = ["## Memory"];
  const grew = state.memoryDiff?.grew ?? [];
  if (grew.length) {
    lines.push("### Growth (between snapshots)");
    for (const g of grew.slice(0, MAX.memory)) {
      lines.push(`- \`${g.className}\` — +${formatBytes(g.bytesDelta)} · +${g.instancesDelta} instances`);
    }
  } else {
    lines.push("_no memory diff captured_");
  }
  if (state.leaks?.length) {
    lines.push("### Leaks (created but not disposed)");
    for (const l of state.leaks.slice(0, MAX.memory)) {
      lines.push(`- \`${l.className}\` ×${l.count}`);
    }
  }
  if (state.images?.available) {
    lines.push("### Image cache");
    lines.push(
      `- ${formatBytes(state.images.cache.currentSizeBytes)} / ${formatBytes(
        state.images.cache.maximumSizeBytes,
      )} · ${state.images.cache.currentSize} entries`,
    );
    for (const img of state.images.oversized.slice(0, MAX.images)) {
      lines.push(
        `- oversized \`${img.source}\` — +${formatBytes(img.overheadBytes)} overhead ×${img.count}`,
      );
    }
  }
  return lines.join("\n");
}

function networkBlock(network?: NetworkRequest[]): string {
  const slow = [...(network ?? [])].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, MAX.http);
  if (!slow.length) return "## Network (latency track)\n_no HTTP samples captured_";
  return [
    `## Network (latency track — ${network?.length ?? 0} requests; slowest first)`,
    "_Latency is UX wait time in ms. It is not an event rate and does not equal build ms._",
    ...slow.map(
      (r) => `- \`${r.method} ${r.uri}\` — ${r.latencyMs.toFixed(0)} ms latency (status ${r.status ?? "—"})`,
    ),
  ].join("\n");
}

function reportBlock(state: AiContextState): string {
  return buildAgentReportMarkdown({
    capturedAt: Date.now(),
    mode: state.mode,
    problems: state.problems,
    errors: state.errors,
    imageStats: state.images ?? null,
    cpuProfile: state.cpuProfile ?? null,
    memoryDiff: state.memoryDiff ?? null,
    network: state.network ?? [],
    hot: state.hot ?? null,
    buildInfo: state.buildInfo ?? null,
  });
}

/**
 * Compact Markdown brief for the model — only data that belongs on this tab.
 * Problems/Report stay cross-cutting; every other section is track-scoped.
 */
export function buildSectionContext(section: AiSection, state: AiContextState): string {
  const frameProblems = problemsOnTrack(state.problems, "frame");
  const networkProblems = problemsOnTrack(state.problems, "network");
  const memoryProblems = problemsOnTrack(state.problems, "memory");
  const hotWidgets =
    (state.hot?.widgets?.length ?? 0) > 0
      ? widgetsBlock(state.hot, { appOnly: true, problems: state.problems })
      : null;

  switch (section) {
    case "problems":
      return [
        sessionBlock(state),
        problemsBlock(state.problems),
        errorsBlock(state.errors),
        framesBlock(state),
        stallsBlock(state),
        deviceBlock(state),
        networkBlock(state.network),
        hotWidgets,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "widgets":
      return [
        sessionBlock(state, {
          problems: frameProblems,
          title: "Widget rebuild health (this screen)",
          note: "Out of scope here: Network, CPU, Memory — use those tabs (or Problems) instead.",
        }),
        widgetProblemsBlock(state.problems, state.hot?.currentRoute),
        widgetsBlock(state.hot, {
          appOnly: true,
          currentRouteOnly: true,
          problems: state.problems,
        }),
      ].join("\n\n");
    case "frames":
      return [
        sessionBlock(state, {
          problems: frameProblems,
          title: "Frame budget health",
          note: "Out of scope here: HTTP latency and memory — use Network / Memory tabs.",
        }),
        framesBlock(state),
        stallsBlock(state),
        scopedProblemsBlock(
          "Frame problems (ranked)",
          frameProblems,
          "none on the frame track",
        ),
        hotWidgets,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "device":
      return [
        sessionBlock(state, {
          problems: state.problems.filter((p) => p.kind === "ui_stall"),
          title: "Device / stall health",
          note: "Out of scope here: HTTP, CPU profiles, and heap — use those tabs.",
          includeBudgets: true,
        }),
        deviceBlock(state),
        stallsBlock(state),
        scopedProblemsBlock(
          "Stall problems (ranked)",
          state.problems.filter((p) => p.kind === "ui_stall"),
          "no ui_stall problems ranked",
        ),
      ].join("\n\n");
    case "cpu":
      return [
        sessionBlock(state, {
          problems: cpuProblems(state.problems),
          title: "CPU health",
          note: "Out of scope here: HTTP latency and memory — use Network / Memory tabs.",
        }),
        cpuBlock(state.cpuProfile),
        scopedProblemsBlock(
          "CPU problems (ranked)",
          cpuProblems(state.problems),
          "no cpu_hotspot problems ranked",
        ),
        // Rebuild evidence helps explain UI-related self-time when present.
        hotWidgets,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "memory":
      return [
        sessionBlock(state, {
          problems: memoryProblems,
          title: "Memory health",
          note: "Out of scope here: rebuilds, frames, and HTTP — use those tabs.",
          includeBudgets: false,
        }),
        memoryBlock(state),
        scopedProblemsBlock(
          "Memory problems (ranked)",
          memoryProblems,
          "none on the memory track",
        ),
      ].join("\n\n");
    case "network":
      return [
        sessionBlock(state, {
          problems: networkProblems,
          title: "Network / latency health",
          note: "Out of scope here: widget rebuilds, frame budgets, and CPU — use those tabs.",
          includeBudgets: false,
        }),
        networkBlock(state.network),
        scopedProblemsBlock(
          "Network problems (ranked)",
          networkProblems,
          "no slow HTTP problems ranked",
        ),
      ].join("\n\n");
    case "report":
      return [
        sessionBlock(state),
        deviceBlock(state),
        stallsBlock(state),
        reportBlock(state),
      ].join("\n\n");
  }
}

const SECTION_SCOPE_RULES: Record<AiSection, string[]> = {
  problems: [
    "This is the Problems tab — review ranked issues across tracks that appear in the brief.",
    "Still separate frame vs network vs memory; do not collapse Slow HTTP into build-ms blame.",
  ],
  widgets: [
    "This is the Widgets tab — stay on rebuilds and widget problems.",
    "Do not discuss Slow HTTP, CPU profiles, heap/leaks, retries, or debounce-of-POST advice.",
    "If the rebuild list is empty or quiet, say so; do not invent widget names or fill with other-tab topics.",
  ],
  frames: [
    "This is the Frames tab — stay on build/raster/jank, UI stalls when listed, and frame-track problems.",
    "Do not review HTTP latency or memory growth/leaks.",
  ],
  device: [
    "This is the Device tab — stay on platform/display context and UI stalls.",
    "Do not review HTTP latency, CPU profiles, or heap/leaks.",
  ],
  cpu: [
    "This is the CPU tab — stay on hotspot self-time and cpu_hotspot problems.",
    "Do not review HTTP latency or memory; mention widgets only if listed in the brief.",
  ],
  memory: [
    "This is the Memory tab — stay on heap growth, leaks, and image cache.",
    "Do not review widget rebuilds, frame budgets, or HTTP.",
  ],
  network: [
    "This is the Network tab — stay on HTTP latency and slow requests.",
    "Do not review widget rebuilds, frame budgets, or CPU hotspots.",
  ],
  report: [
    "This is the Report tab — whole-session review across tracks present in the brief.",
  ],
};

const SECTION_SUMMARY_RULE: Record<AiSection, string> = {
  problems: "1. ## Summary — 2–3 sentences on session health and the main risk (name the track: frame vs network vs memory)",
  widgets:
    "1. ## Summary — 2–3 sentences on rebuild/widget health on this screen (not other tabs)",
  frames: "1. ## Summary — 2–3 sentences on frame-budget health (build/raster/jank)",
  device: "1. ## Summary — 2–3 sentences on device/display context and stall risk",
  cpu: "1. ## Summary — 2–3 sentences on CPU hotspot risk from the profile",
  memory: "1. ## Summary — 2–3 sentences on heap/leak/image-cache risk",
  network: "1. ## Summary — 2–3 sentences on HTTP latency / UX wait risk",
  report: "1. ## Summary — 2–3 sentences on whole-session health and the main risk (name the track)",
};

const SECTION_FINDINGS_RULE: Record<AiSection, string> = {
  problems: "2. ## Findings — up to 5 bullets with measured evidence (widget + route when relevant)",
  widgets: "2. ## Findings — up to 5 bullets with widget + route + rebuild evidence",
  frames: "2. ## Findings — up to 5 bullets with frame metrics and related widgets when listed",
  device: "2. ## Findings — up to 5 bullets with platform/display/stall evidence",
  cpu: "2. ## Findings — up to 5 bullets with hotspot names and self-time %",
  memory: "2. ## Findings — up to 5 bullets with class/image names and byte evidence",
  network: "2. ## Findings — up to 5 bullets with method + URI + latency ms",
  report: "2. ## Findings — up to 5 bullets with measured evidence across tracks",
};

export function systemPrompt(section: AiSection, language: AiLanguage): string {
  const lang =
    language === "en"
      ? "Write the entire answer in clear, professional English."
      : "کل پاسخ را به فارسیِ حرفه‌ای، دقیق و کامل بنویس.";
  return [
    "You are a senior Flutter performance engineer reviewing a live PulseFlow session.",
    "Use ONLY the measurements below; never invent widgets, routes, file paths, libraries, APIs, or numbers. If data is missing, say so.",
    "Stay strictly on this tab's topic — do not import findings from other PulseFlow tabs unless they appear in the brief.",
    "Be concise and skeptical of exaggeration — prefer understatement over drama.",
    "Always finish a complete answer — never stop mid-sentence, mid-list, or mid-heading.",
    "Accuracy rules:",
    "- Keep **frame-budget** issues (build/raster/jank/rebuilds/CPU) separate from **network** latency. Slow HTTP is UX wait; do not claim it causes high build ms unless rebuilds are tied to the response landing.",
    "- Prefer app widgets over framework/private (`_…`) / Animated* / *Transition shells. Do not list Focus/Ink/Selection/Actions/AnimatedDefaultTextStyle internals as separate HIGH findings.",
    "- When a **screen/route** shows a high rebuild rate (e.g. 40+/s or ≥40% share) alongside high P95 build or jank, treat that as **scroll/list interaction cost** on that screen — not as one tiny 0.1–1/s child widget causing the whole budget miss.",
    "- Never claim a widget under ~3 rebuilds/s is the primary cause of 100ms+ P95 build. Cite screen totals and high-rate app widgets first.",
    "- HTTP evidence is latency in ms only — never invent an event rate from latency.",
    "- Do not multiply relatedBuild / session build cost across widgets; that cost is frame-wide when present.",
    "- Do not blame SvgPicture/GC for frame jank unless image/memory metrics in the brief support it.",
    "- Cap ## Findings at 5 bullets and ## Fixes at 3. Rank by measured impact. Do not invent Hive/dio interceptors/etc. unless the brief already mentions them.",
    ...SECTION_SCOPE_RULES[section],
    "When citing UI issues, name them as `WidgetName` on `/route` and include `file:line` when present.",
    "Structure every answer with these Markdown headings, in order:",
    SECTION_SUMMARY_RULE[section],
    SECTION_FINDINGS_RULE[section],
    "3. ## Fixes — up to 3, ranked by impact, with concrete changes grounded in the data",
    "4. ## Verify — what to re-measure in PulseFlow after the fix (prefer this same tab)",
    "Close with one clear next step. Keep tone professional and actionable; avoid fluff.",
    `Focus on ${SECTION_HINTS[section]}.`,
    lang,
  ].join(" ");
}

export function buildChatMessages(
  section: AiSection,
  context: string,
  question?: string,
  language: AiLanguage = "fa",
  history?: ChatMessage[],
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(section, language) },
  ];
  for (const turn of history ?? []) {
    if (turn.role === "system") continue;
    messages.push({ role: turn.role, content: turn.content });
  }
  const ask = question?.trim() || SECTION_DEFAULT_QUESTION[section];
  messages.push({
    role: "user",
    content: `Current PulseFlow “${SECTION_TITLES[section]}” data:\n\n${context}\n\n---\n${ask}`,
  });
  return messages;
}
