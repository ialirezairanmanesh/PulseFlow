/**
 * Per-section context builders + prompts for the AI drawer.
 *
 * Pure module (no React, no node:fs): it turns the same data the dashboard already
 * renders into a compact Markdown brief for the model, reusing `buildProblems`,
 * `computeVerdict`, and `buildAgentReportMarkdown` instead of re-deriving anything.
 */
import { buildAgentReportMarkdown } from "@/lib/agent-report";
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
  problems: "the ranked problems, session health verdict, and which widgets/routes drive them",
  widgets: "widget rebuild pressure by widget name, route/screen, source location, and rebuild root",
  frames: "frame timing (build/raster) against the frame budget, tied to hot widgets when present",
  cpu: "CPU hotspots by self-time, tied to UI rebuild cost when widget data is present",
  memory: "heap growth, leaks, and image-cache waste",
  network: "slow HTTP requests on the critical path",
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
    "Write a complete professional review: summary, findings with widget + route, ranked fixes, and how to verify.",
  topFixes:
    "Give the top 3 fixes by impact. Name each widget and its route/screen, with concrete Flutter steps.",
  regression:
    "Is anything regressing? Name the widgets/routes to watch and what metric should improve after a fix.",
} as const;

const DEFAULT_QUESTION =
  "Write a complete professional performance review of this view. Name every problematic widget with its route/screen, rank fixes by impact, and end with what to re-measure. Do not stop mid-answer.";

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

function problemsBlock(problems: PerformanceProblem[]): string {
  if (!problems.length) return "## Problems (ranked)\n_none detected in this session_";
  const lines = ["## Problems (ranked by impact)"];
  problems.slice(0, MAX.problems).forEach((p, i) => {
    const impact = p.impact != null ? ` (impact ${p.impact})` : "";
    const widgetAt =
      p.widget && p.route
        ? ` — \`${p.widget}\` on ${p.route}`
        : p.widget
          ? ` — \`${p.widget}\``
          : p.route
            ? ` — route ${p.route}`
            : "";
    lines.push(`${i + 1}. **[${p.severity.toUpperCase()}] ${p.title}**${widgetAt}${impact}`);
    if (p.why) lines.push(`   - Why: ${p.why}`);
    lines.push(`   - Fix: ${p.action}`);
    const where = [
      p.sourceUri ? `${p.sourceUri}${p.sourceLine ? `:${p.sourceLine}` : ""}` : "",
      p.cause ? `cause: ${p.cause}` : "",
      p.ratePerSec != null ? `${p.ratePerSec.toFixed(1)}/s` : "",
      p.share != null ? `${p.share.toFixed(1)}% share` : "",
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
  if (w.isFramework) parts.push("framework");
  return `- ${parts.join(" · ")}`;
}

function widgetsBlock(hot?: HotWidgetsPayload | null): string {
  const widgets = hot?.widgets ?? [];
  if (!widgets.length) return "## Widget rebuilds\n_no widget data (probe may be missing)_";
  const lines = [
    `## Widget rebuilds (window ${((hot?.windowMs ?? 10000) / 1000).toFixed(0)}s)`,
    "_Always cite widgets as `WidgetName` on `/route` (include file:line when shown)._",
  ];
  if (hot?.currentRoute) {
    lines.push(`- Current route/screen: **${hot.currentRoute}**`);
  }
  lines.push(...widgets.slice(0, MAX.widgets).map(formatWidgetLine));
  const screens = hot?.screens ?? [];
  if (screens.length) {
    lines.push("", "### By screen / route");
    for (const s of screens.slice(0, 8)) {
      const tops = (s.topWidgets ?? [])
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
  const lines = ["## Frames"];
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
  if (!slow.length) return "## Network\n_no HTTP samples captured_";
  return [
    `## Network (${network?.length ?? 0} requests; slowest first)`,
    ...slow.map(
      (r) => `- \`${r.method} ${r.uri}\` — ${r.latencyMs.toFixed(0)} ms (status ${r.status ?? "—"})`,
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
      blocks.push(problemsBlock(state.problems), errorsBlock(state.errors));
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
  // Cross-cutting widget/route evidence so every section can name concrete UI locations.
  if (section !== "widgets" && section !== "report" && (state.hot?.widgets?.length ?? 0) > 0) {
    blocks.push(widgetsBlock(state.hot));
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
    "Use ONLY the measurements below; never invent widgets, routes, file paths, or numbers. If data is missing, say so.",
    "Always finish a complete answer — never stop mid-sentence, mid-list, or mid-heading.",
    "When citing UI issues, name them as `WidgetName` on `/route` and include `file:line` when present. Prefer app widgets over framework widgets unless the framework widget is the rebuild root.",
    "Structure every answer with these Markdown headings, in order:",
    "1. ## Summary — 2–4 sentences on session health and the main risk",
    "2. ## Findings — bullets with widget + route + measured evidence (rate, share, jank, source)",
    "3. ## Fixes — ranked by impact, with concrete Flutter changes (const, keys, selectors, caching, etc.)",
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
