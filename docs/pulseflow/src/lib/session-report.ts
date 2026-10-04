import type {
  CpuProfileSummary,
  LeakEntry,
  MemoryDiff,
  NetworkRequest,
  PerformanceProblem,
  ScenarioResult,
  SessionBaseline,
} from "@/lib/types";

export interface SessionReportInput {
  capturedAt: number;
  mode?: "live" | "mock";
  isolateName?: string;
  problems: PerformanceProblem[];
  cpuProfile?: CpuProfileSummary | null;
  memoryDiff?: MemoryDiff | null;
  network: NetworkRequest[];
  scenarioResult?: ScenarioResult | null;
  leaks?: LeakEntry[];
  baselines: SessionBaseline[];
}

export function buildSessionReportJson(input: SessionReportInput) {
  const slowHttp = [...input.network]
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, 10);
  return {
    tool: "PulseFlow",
    version: "0.2.0",
    capturedAt: input.capturedAt,
    mode: input.mode,
    isolateName: input.isolateName,
    problems: input.problems,
    cpuHotspots: input.cpuProfile?.topFunctions?.slice(0, 10) ?? [],
    memoryDiff: input.memoryDiff ?? null,
    leaks: input.leaks ?? [],
    slowHttp,
    scenarioResult: input.scenarioResult ?? null,
    baselines: input.baselines,
  };
}

export function buildSessionReportMarkdown(input: SessionReportInput): string {
  const data = buildSessionReportJson(input);
  const lines: string[] = [
    "# PulseFlow session report",
    "",
    `- Captured: ${new Date(input.capturedAt).toISOString()}`,
    `- Mode: ${input.mode ?? "unknown"}`,
    `- Isolate: ${input.isolateName ?? "—"}`,
    "",
    "## Top problems",
    "",
  ];
  if (!data.problems.length) {
    lines.push("_No ranked problems in this session._", "");
  } else {
    for (const p of data.problems) {
      lines.push(`### ${p.severity.toUpperCase()} — ${p.title}`);
      lines.push(p.detail);
      lines.push(`**Fix:** ${p.action}`);
      lines.push("");
    }
  }

  lines.push("## CPU hotspots", "");
  if (!data.cpuHotspots.length) {
    lines.push("_No CPU profile captured._", "");
  } else {
    for (const fn of data.cpuHotspots) {
      lines.push(
        `- **${fn.qualifiedName}** — ${fn.selfPercent}% self / ${fn.totalPercent}% total`,
      );
    }
    lines.push("");
  }

  lines.push("## Memory delta", "");
  if (!data.memoryDiff?.grew?.length) {
    lines.push("_No memory diff captured._", "");
  } else {
    for (const g of data.memoryDiff.grew.slice(0, 10)) {
      lines.push(
        `- **${g.className}** — +${(g.bytesDelta / (1024 * 1024)).toFixed(2)} MB, +${g.instancesDelta} instances`,
      );
    }
    lines.push("");
  }

  lines.push("## Leaks", "");
  if (!data.leaks?.length) {
    lines.push("_No leak report captured._", "");
  } else {
    for (const l of data.leaks) {
      lines.push(`- **${l.className}** — ${l.count} outstanding`);
    }
    lines.push("");
  }

  lines.push("## Slow HTTP", "");
  if (!data.slowHttp.length) {
    lines.push("_No HTTP samples._", "");
  } else {
    for (const r of data.slowHttp) {
      lines.push(`- \`${r.method} ${r.uri}\` — ${r.latencyMs} ms (status ${r.status ?? "—"})`);
    }
    lines.push("");
  }

  lines.push("## Scenario", "");
  if (!data.scenarioResult) {
    lines.push("_No scenario result._", "");
  } else {
    const r = data.scenarioResult;
    lines.push(
      `- ${r.id}: ok=${r.ok}${r.stubbed ? " (stubbed)" : ""}${r.message ? ` — ${r.message}` : ""}`,
    );
    lines.push("");
  }

  lines.push("## Baselines", "");
  if (!data.baselines.length) {
    lines.push("_No baselines captured._", "");
  } else {
    for (const b of data.baselines) {
      lines.push(
        `- **${b.label}** — P95 build ${b.p95BuildMs} ms, rebuild ${b.rebuildRate}/s, heap ${b.heapMb} MB, jank ${(b.jankRatio * 100).toFixed(0)}%`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBase64(filename: string, base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
