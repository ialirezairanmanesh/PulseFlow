import { formatBytes } from "@/lib/utils";
import type {
  CpuProfileSummary,
  ErrorEntry,
  HotWidgetsPayload,
  ImageCacheStats,
  MemoryDiff,
  NetworkRequest,
  OversizedImage,
  PerformanceProblem,
  ProbeAvailability,
  RebuildCauseRoot,
  SessionBaseline,
} from "@/lib/types";
import type { SessionStats } from "@/lib/session-history";

export interface AgentImageStats {
  available: boolean;
  cache: ImageCacheStats;
  oversized: OversizedImage[];
}

export interface AgentReportInput {
  capturedAt: number;
  mode?: string;
  isolateName?: string;
  refreshRate?: number;
  budgetMs?: number;
  problems: PerformanceProblem[];
  rebuildRoots?: RebuildCauseRoot[];
  errors?: ErrorEntry[];
  imageStats?: AgentImageStats | null;
  cpuProfile?: CpuProfileSummary | null;
  memoryDiff?: MemoryDiff | null;
  network?: NetworkRequest[];
  hot?: HotWidgetsPayload | null;
  stats?: SessionStats | null;
  baselines?: SessionBaseline[];
  buildInfo?: { buildMode: string; probes: ProbeAvailability } | null;
}

/** Instruction header the dashboard prepends so an agent knows what to do. */
export const AGENT_PROMPT =
  "You are a senior Flutter performance engineer. Using ONLY the PulseFlow data below, produce an " +
  "execution-ready fix plan ranked by impact. For EACH fix give: (1) Target — the exact widget/class " +
  "and `file:line` when present, plus its route/screen; (2) Evidence — the measured numbers that justify " +
  "it (impact, /s, share %, ms, bytes); (3) Change — the specific Flutter/Dart edit naming the APIs to " +
  "add/change/remove, with a short before→after snippet; (4) Verify — the exact PulseFlow metric/tab to " +
  "re-measure. Cap at 3 fixes unless more are clearly independent. Never invent widgets, files, " +
  "libraries, or numbers; if a source location is missing, say what to open instead of guessing. Keep " +
  "frame-budget (build/raster/jank/rebuild) issues separate from network latency (ms) and memory " +
  "(bytes). Lower is better for all times, rates, and ratios.";

const MAX = {
  problems: 12,
  roots: 10,
  errors: 10,
  images: 10,
  cpu: 12,
  http: 10,
  memory: 10,
} as const;

function slowHttp(network: NetworkRequest[]): NetworkRequest[] {
  return [...network].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, MAX.http);
}

/**
 * Explains what this session can and cannot show, so an agent does not misread
 * empty sections as "no problems".
 */
export function buildCoverageLines(input: AgentReportInput): string[] {
  const lines: string[] = [];
  const mode = input.buildInfo?.buildMode;
  const probes = input.buildInfo?.probes ?? {};
  if (mode) lines.push(`- Build mode: **${mode}**`);
  if (probes.rebuildProbe === false) {
    lines.push(
      "- Widget rebuild data unavailable: rebuild tracking needs a Debug build (Flutter's " +
        "`debugOnRebuildDirtyWidget` is assert-only). Use Debug to find rebuilds, Profile for " +
        "accurate frame/CPU cost.",
    );
  }
  if (probes.sourceLocations === false) {
    lines.push("- Source locations (`file:line`) unavailable: widget-creation tracking is Debug-only.");
  }
  if (probes.leaks === false) {
    lines.push("- Leak report unavailable in this build mode.");
  }
  if (!input.cpuProfile) {
    lines.push("- No CPU profile captured — record 3–5 s on `/cpu` while reproducing jank to get function hotspots.");
  }
  if (!input.memoryDiff?.grew?.length) {
    lines.push("- No memory diff — capture two snapshots and diff on `/memory`.");
  }
  if (!input.rebuildRoots?.length && probes.rebuildProbe !== false) {
    lines.push("- No rebuild roots in the window — interact with the UI to surface rebuilds.");
  }
  if (!input.errors?.length) {
    lines.push("- No runtime errors captured in this session.");
  }
  if (input.imageStats?.available && input.imageStats.oversized.length === 0) {
    lines.push("- Image cache healthy: no oversized decodes detected.");
  }
  if (!input.imageStats) {
    lines.push("- No image data captured (needs a debug/profile build that paints images).");
  }
  if (slowHttp(input.network ?? []).length === 0) {
    lines.push("- No slow HTTP samples.");
  }
  return lines;
}

export function buildAgentReportJson(input: AgentReportInput) {
  return {
    tool: "PulseFlow",
    version: "0.3.0",
    kind: "agent-report",
    prompt: AGENT_PROMPT,
    capturedAt: input.capturedAt,
    mode: input.mode,
    isolateName: input.isolateName,
    refreshRate: input.refreshRate,
    budgetMs: input.budgetMs,
    stats: input.stats ?? null,
    problems: input.problems.slice(0, MAX.problems),
    rebuildRoots: (input.rebuildRoots ?? []).slice(0, MAX.roots),
    errors: (input.errors ?? []).slice(0, MAX.errors),
    images: input.imageStats ?? null,
    cpuHotspots: input.cpuProfile?.topFunctions?.slice(0, MAX.cpu) ?? [],
    memoryDiff: input.memoryDiff?.grew?.slice(0, MAX.memory) ?? null,
    slowHttp: slowHttp(input.network ?? []),
    baselines: input.baselines ?? [],
  };
}

export function buildAgentReportMarkdown(input: AgentReportInput): string {
  const data = buildAgentReportJson(input);
  const lines: string[] = [];

  lines.push("# PulseFlow agent report", "");
  lines.push(`> ${AGENT_PROMPT}`, "");
  lines.push(`- Captured: ${new Date(input.capturedAt).toISOString()}`);
  lines.push(`- Mode: ${input.mode ?? "unknown"} · isolate: ${input.isolateName ?? "—"}`);
  if (input.refreshRate || input.budgetMs) {
    lines.push(
      `- Display: ${input.refreshRate ? `${input.refreshRate} Hz` : "—"} · frame budget ${
        input.budgetMs ? `${input.budgetMs.toFixed(2)} ms` : "—"
      }`,
    );
  }
  if (data.stats) {
    lines.push(
      `- Session P95 build ${data.stats.p95BuildMs} ms · raster ${data.stats.p95RasterMs} ms · ` +
        `jank ${(data.stats.jankRatio * 100).toFixed(0)}% · problems ${data.stats.problemCount}`,
    );
  }
  lines.push("");
  lines.push("## Output format (follow exactly)", "");
  lines.push("For each fix, in priority order:", "");
  lines.push("1. **Target** — `WidgetName` on `/route` (and `file:line` when present)");
  lines.push("2. **Evidence** — the measured numbers from below that justify it");
  lines.push(
    "3. **Change** — the exact Flutter/Dart edit naming the APIs, with a short before→after snippet",
  );
  lines.push("4. **Verify** — the PulseFlow tab/metric to re-measure");
  lines.push("");

  const coverage = buildCoverageLines(input);
  if (coverage.length) {
    lines.push("## Coverage / missing data", "");
    lines.push(...coverage);
    lines.push("");
  }

  lines.push("## Problems (ranked)", "");
  if (!data.problems.length) {
    lines.push("_No ranked problems in this session._", "");
  } else {
    data.problems.forEach((p, i) => {
      const impactLabel = p.impact != null ? ` (impact ${p.impact})` : "";
      const widgetAt =
        p.widget && p.route
          ? ` — \`${p.widget}\` on ${p.route}`
          : p.widget
            ? ` — \`${p.widget}\``
            : p.route
              ? ` — route ${p.route}`
              : "";
      lines.push(
        `${i + 1}. **[${p.severity.toUpperCase()}] ${p.title}**${widgetAt}${impactLabel} — ${p.detail}`,
      );
      if (p.why) {
        lines.push(`   - Why: ${p.why}`);
      }
      lines.push(`   - Fix: ${p.action}`);
      const evidence = [
        p.sourceUri ? `${p.sourceUri}${p.sourceLine ? `:${p.sourceLine}` : ""}` : "",
        p.cause ? `cause: ${p.cause}` : "",
        p.ratePerSec != null && p.kind !== "slow_http" ? `${p.ratePerSec.toFixed(1)}/s` : "",
        p.share != null ? `${p.share.toFixed(1)}% share` : "",
        p.latencyMs != null ? `${p.latencyMs.toFixed(0)} ms latency` : "",
        p.relatedBuildMs != null ? `relatedBuild ${p.relatedBuildMs.toFixed(1)} ms` : "",
        p.duringJank ? "during jank" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (evidence) lines.push(`   - Evidence: ${evidence}`);
    });
    lines.push("");
  }

  if (data.rebuildRoots.length) {
    lines.push("## Rebuild roots (why things rebuild)", "");
    for (const r of data.rebuildRoots) {
      lines.push(
        `- \`${r.widget}\` on ${r.route} — ${r.ratePerSec}/s · ${r.rebuilds} rebuilds · ${r.children} children`,
      );
    }
    lines.push("");
  }

  if (data.errors.length) {
    lines.push("## Errors", "");
    for (const e of data.errors) {
      lines.push(
        `- ${e.kind.toUpperCase()} ×${e.count}${e.route ? ` on ${e.route}` : ""} — ${e.signature}`,
      );
      if (e.top[0]) lines.push(`  - ${e.top[0]}`);
    }
    lines.push("");
  }

  if (data.images?.available) {
    lines.push("## Image cache", "");
    lines.push(
      `- ${formatBytes(data.images.cache.currentSizeBytes)} / ${formatBytes(
        data.images.cache.maximumSizeBytes,
      )} · ${data.images.cache.currentSize} entries · ${data.images.cache.live} live · ${
        data.images.cache.pending
      } pending`,
    );
    lines.push("");
  }

  if (data.images?.available && data.images.oversized.length) {
    lines.push("## Oversized images", "");
    for (const img of data.images.oversized.slice(0, MAX.images)) {
      lines.push(
        `- \`${img.source}\` — +${formatBytes(img.overheadBytes)} overhead (decoded ${formatBytes(
          img.decodedBytes,
        )}, shown ${formatBytes(img.displayBytes)}) ×${img.count} — add cacheWidth/cacheHeight`,
      );
    }
    lines.push("");
  }

  if (data.cpuHotspots.length) {
    lines.push("## CPU hotspots", "");
    for (const fn of data.cpuHotspots) {
      lines.push(
        `- \`${fn.qualifiedName}\` — ${fn.selfPercent}% self / ${fn.totalPercent}% total${fn.codeUri ? ` (${fn.codeUri})` : ""}`,
      );
    }
    lines.push("");
  }

  if (data.memoryDiff?.length) {
    lines.push("## Memory growth", "");
    for (const g of data.memoryDiff) {
      lines.push(
        `- \`${g.className}\` — +${formatBytes(g.bytesDelta)} · +${g.instancesDelta} instances`,
      );
    }
    lines.push("");
  }

  if (data.slowHttp.length) {
    lines.push("## Slow HTTP", "");
    for (const r of data.slowHttp) {
      lines.push(`- \`${r.method} ${r.uri}\` — ${r.latencyMs.toFixed(0)} ms (status ${r.status ?? "—"})`);
    }
    lines.push("");
  }

  if (input.hot?.widgets?.length) {
    lines.push("## Top rebuilding widgets", "");
    for (const w of input.hot.widgets.slice(0, 10)) {
      lines.push(
        `- \`${w.name}\` on ${w.route} — ${w.ratePerSec}/s (${w.share}% share)${w.isFramework ? " [framework]" : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
