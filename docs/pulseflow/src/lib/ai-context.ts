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
import type { AiLanguage } from "@/lib/ai-providers";
import type {
  CpuProfileSummary,
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
} from "@/lib/types";

export type AiSection =
  | "problems"
  | "widgets"
  | "frames"
  | "cpu"
  | "memory"
  | "network"
  | "report";

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
}

export const SECTION_TITLES: Record<AiSection, string> = {
  problems: "Problems",
  widgets: "Widgets",
  frames: "Frames",
  cpu: "CPU",
  memory: "Memory",
  network: "Network",
  report: "Report",
};

const SECTION_HINTS: Record<AiSection, string> = {
  problems: "the ranked problems, session health verdict, and which app widgets/routes drive them",
  widgets: "widget rebuild pressure by widget name, route/screen, source location, and rebuild root",
  frames: "frame timing (build/raster) against the frame budget, tied to hot widgets when present",
  cpu: "CPU hotspots by self-time, tied to UI rebuild cost when widget data is present",
  memory: "heap growth, leaks, and image-cache waste",
  network: "slow HTTP requests (latency / UX wait — separate from frame build cost)",
  report: "the whole session across performance, widgets, CPU, memory, and network",
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

const DEFAULT_QUESTION =
  "Write a concise, accurate performance review. Prefer screen/route rebuild totals and high-rate app widgets over 0–1/s Animated shells. If jank spikes while scrolling a table/list, say so. Cap Findings at 5 and Fixes at 3. Separate frame-budget issues from network latency. Do not invent numbers, libraries, or file paths.";

export function sectionFromPath(pathname: string): AiSection {
  const clean = pathname.replace(/\/+$/, "");
  if (clean.startsWith("/widgets")) return "widgets";
  if (clean.startsWith("/frames")) return "frames";
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

function sessionBlock(state: AiContextState): string {
  const verdict = computeVerdict({
    points: state.points,
    problems: state.problems,
    budgetMs: state.budgetMs,
  });
  return [
    "## Session health",
    `- Verdict: **${verdict.status}** (score ${verdict.score}/100)`,
    `- ${verdict.headline}`,
    `- Budgets: ${verdict.budgets
      .map((b) => `${b.label} ${budgetText(b)} ${b.passed ? "ok" : "OVER"}`)
      .join(" · ")}`,
    `- Mode: ${state.mode ?? "unknown"}`,
  ].join("\n");
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
      return "frame";
    default:
      return "other";
  }
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

function formatWidgetLine(w: {
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
}): string {
  const parts = [
    `\`${w.name}\` on ${w.route}`,
    `${w.ratePerSec.toFixed(1)}/s`,
    `${w.share.toFixed(1)}% share`,
  ];
  if (w.keyLabel) parts.push(`key ${w.keyLabel}`);
  if (w.sourceUri) parts.push(`${w.sourceUri}${w.sourceLine ? `:${w.sourceLine}` : ""}`);
  if (w.cause) parts.push(`cause ${w.cause}`);
  if (w.duringJank) parts.push("during jank");
  if (w.isFramework || isFrameworkWidget(w)) parts.push("framework — ignore unless rebuild root");
  return `- ${parts.join(" · ")}`;
}

function widgetsBlock(hot?: HotWidgetsPayload | null, opts?: { appOnly?: boolean }): string {
  const raw = hot?.widgets ?? [];
  let widgets = opts?.appOnly ? raw.filter((w) => !isFrameworkWidget(w)) : raw;
  // Drop near-idle rows so the model cannot invent "HIGH" from 0.1–1.0/s shells.
  if (opts?.appOnly) {
    widgets = widgets.filter((w) => w.ratePerSec >= 3 || w.share >= 8);
  }
  widgets = [...widgets].sort(
    (a, b) => b.ratePerSec - a.ratePerSec || b.share - a.share,
  );
  if (!widgets.length) {
    return opts?.appOnly && raw.length
      ? "## App widget rebuilds\n_no meaningful app rebuild rate in this window; use screen totals below_"
      : "## Widget rebuilds\n_no widget data (probe may be missing)_";
  }
  const lines = [
    `## ${opts?.appOnly ? "App widget" : "Widget"} rebuilds (window ${((hot?.windowMs ?? 10000) / 1000).toFixed(0)}s)`,
    "_Cite as `WidgetName` on `/route` (file:line when shown). Prefer app widgets; skip framework shells. Widgets under ~3/s are not primary causes of 100ms+ build._",
  ];
  if (hot?.currentRoute) {
    lines.push(`- Current route/screen: **${hot.currentRoute}**`);
  }
  lines.push(...widgets.slice(0, MAX.widgets).map(formatWidgetLine));
  const screens = hot?.screens ?? [];
  if (screens.length) {
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
    lines.push(`- Latest frame: ${point.frameMs.toFixed(1)} ms · heap ${point.heapMb.toFixed(1)} MB`);
    if (point.refreshRate) lines.push(`- Display: ${point.refreshRate} Hz`);
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

/** A compact Markdown brief of the current section for the model. */
export function buildSectionContext(section: AiSection, state: AiContextState): string {
  const blocks: string[] = [sessionBlock(state)];
  switch (section) {
    case "problems":
      blocks.push(
        problemsBlock(state.problems),
        errorsBlock(state.errors),
        framesBlock(state),
        networkBlock(state.network),
      );
      break;
    case "widgets":
      blocks.push(widgetsBlock(state.hot));
      break;
    case "frames":
      blocks.push(framesBlock(state));
      break;
    case "cpu":
      blocks.push(cpuBlock(state.cpuProfile));
      break;
    case "memory":
      blocks.push(memoryBlock(state));
      break;
    case "network":
      blocks.push(networkBlock(state.network));
      break;
    case "report":
      blocks.push(reportBlock(state));
      break;
  }
  // Cross-cutting app widget/route evidence (skip framework noise for the model).
  if (section !== "widgets" && section !== "report" && (state.hot?.widgets?.length ?? 0) > 0) {
    blocks.push(widgetsBlock(state.hot, { appOnly: true }));
  }
  return blocks.join("\n\n");
}

export function systemPrompt(section: AiSection, language: AiLanguage): string {
  const lang =
    language === "en"
      ? "Write the entire answer in clear, professional English."
      : "کل پاسخ را به فارسیِ حرفه‌ای، دقیق و کامل بنویس.";
  return [
    "You are a senior Flutter performance engineer reviewing a live PulseFlow session.",
    "Use ONLY the measurements below; never invent widgets, routes, file paths, libraries, APIs, or numbers. If data is missing, say so.",
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
    "When citing UI issues, name them as `WidgetName` on `/route` and include `file:line` when present.",
    "Structure every answer with these Markdown headings, in order:",
    "1. ## Summary — 2–3 sentences on session health and the main risk (name the track: frame vs network)",
    "2. ## Findings — up to 5 bullets with widget + route + measured evidence",
    "3. ## Fixes — up to 3, ranked by impact, with concrete Flutter changes grounded in the data",
    "4. ## Verify — what to re-measure in PulseFlow after the fix",
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
  const ask = question?.trim() || DEFAULT_QUESTION;
  messages.push({
    role: "user",
    content: `Current PulseFlow “${SECTION_TITLES[section]}” data:\n\n${context}\n\n---\n${ask}`,
  });
  return messages;
}
