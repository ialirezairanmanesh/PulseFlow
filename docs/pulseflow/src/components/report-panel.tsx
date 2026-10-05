"use client";

import { useState } from "react";
import { buildAgentReportMarkdown } from "@/lib/agent-report";
import { Button } from "@/components/ui/button";
import { buildProblems, computeBaselineMetrics } from "@/lib/problems";
import {
  buildSessionReportJson,
  buildSessionReportMarkdown,
  downloadText,
} from "@/lib/session-report";
import type { SessionStats } from "@/lib/session-history";
import { usePulse } from "@/lib/pulse-store";

export function ReportPanel() {
  const [saveMessage, setSaveMessage] = useState<string>();
  const {
    connected,
    mode,
    isolateName,
    hot,
    hotAvailable,
    points,
    gcEvents,
    cpuProfile,
    memoryDiff,
    network,
    scenarioResult,
    scenarioRunning,
    leaks,
    rebuildCauses,
    appErrors,
    images,
    baselines,
  } = usePulse();

  const problems = buildProblems({
    hot,
    hotAvailable,
    latest: points.at(-1),
    gcEvents,
    cpuProfile,
    memoryDiff,
    network,
    points,
    scenarioResult,
    scenarioRunning,
  });

  const before = baselines.find((b) => b.label === "before");
  const after = baselines.find((b) => b.label === "after");

  const exportJson = () => {
    const data = buildSessionReportJson({
      capturedAt: Date.now(),
      mode,
      isolateName,
      problems,
      cpuProfile,
      memoryDiff,
      network,
      scenarioResult,
      leaks,
      baselines,
    });
    downloadText(
      `pulseflow-report-${Date.now()}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
  };

  const exportMd = () => {
    const md = buildSessionReportMarkdown({
      capturedAt: Date.now(),
      mode,
      isolateName,
      problems,
      cpuProfile,
      memoryDiff,
      network,
      scenarioResult,
      leaks,
      baselines,
    });
    downloadText(`pulseflow-report-${Date.now()}.md`, md, "text/markdown");
  };

  const saveSession = async () => {
    const baseline = computeBaselineMetrics({
      points,
      hot,
      problemCount: problems.length,
      label: "session",
    });
    const stats: SessionStats = {
      problemCount: baseline.problemCount,
      p95BuildMs: baseline.p95BuildMs,
      p95RasterMs: baseline.p95RasterMs,
      p95FrameMs: baseline.p95FrameMs,
      rebuildRate: baseline.rebuildRate,
      heapMb: baseline.heapMb,
      jankRatio: baseline.jankRatio,
    };
    const report = buildSessionReportJson({
      capturedAt: Date.now(),
      mode,
      isolateName,
      problems,
      cpuProfile,
      memoryDiff,
      network,
      scenarioResult,
      leaks,
      baselines,
    });
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: new Date().toLocaleString(),
          mode,
          isolateName,
          stats,
          report,
        }),
      });
      setSaveMessage(res.ok ? "Session saved to history" : "Could not save session");
    } catch {
      setSaveMessage("Could not save session");
    }
  };

  const agentInput = () => {
    const latest = points.at(-1);
    const baseline = computeBaselineMetrics({
      points,
      hot,
      problemCount: problems.length,
      label: "agent",
    });
    const stats: SessionStats = {
      problemCount: baseline.problemCount,
      p95BuildMs: baseline.p95BuildMs,
      p95RasterMs: baseline.p95RasterMs,
      p95FrameMs: baseline.p95FrameMs,
      rebuildRate: baseline.rebuildRate,
      heapMb: baseline.heapMb,
      jankRatio: baseline.jankRatio,
    };
    return {
      capturedAt: Date.now(),
      mode,
      isolateName,
      refreshRate: latest?.refreshRate,
      budgetMs: latest?.buildBudgetMs,
      problems,
      rebuildRoots: rebuildCauses?.roots,
      errors: appErrors,
      imageStats: images,
      cpuProfile,
      memoryDiff,
      network,
      hot,
      stats,
      baselines,
    };
  };

  const copyAgentReport = async () => {
    const md = buildAgentReportMarkdown(agentInput());
    try {
      await navigator.clipboard.writeText(md);
      setSaveMessage("Agent report copied to clipboard");
    } catch {
      downloadText(`pulseflow-agent-${Date.now()}.md`, md, "text/markdown");
      setSaveMessage("Clipboard blocked — downloaded instead");
    }
  };

  const downloadAgentReport = () => {
    downloadText(
      `pulseflow-agent-${Date.now()}.md`,
      buildAgentReportMarkdown(agentInput()),
      "text/markdown",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Report
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Export a short session report and compare before/after baselines
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!connected} onClick={() => void copyAgentReport()}>
            Copy agent report
          </Button>
          <Button size="sm" variant="outline" disabled={!connected} onClick={downloadAgentReport}>
            Agent .md
          </Button>
          <Button size="sm" variant="outline" disabled={!connected} onClick={() => void saveSession()}>
            Save session
          </Button>
          <Button size="sm" variant="secondary" disabled={!connected} onClick={exportMd}>
            Export Markdown
          </Button>
          <Button size="sm" variant="secondary" disabled={!connected} onClick={exportJson}>
            Export JSON
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <h3 className="mb-2 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
          Session snapshot
        </h3>
        {saveMessage && (
          <p className="mb-2 text-sm text-[var(--ink-muted)]">{saveMessage}</p>
        )}
        <ul className="space-y-1 text-sm text-[var(--ink-muted)]">
          <li>Problems ranked: {problems.length}</li>
          <li>CPU hotspots: {cpuProfile?.topFunctions?.length ?? 0}</li>
          <li>HTTP samples: {network.length}</li>
          <li>Memory diff growers: {memoryDiff?.grew?.length ?? 0}</li>
          <li>Leaked objects: {leaks.length}</li>
          <li>
            Last scenario:{" "}
            {scenarioResult
              ? `${scenarioResult.id} (ok=${scenarioResult.ok})`
              : scenarioRunning ?? "—"}
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
          Baseline compare
        </h3>
        {!before && !after ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Capture before/after baselines on the Tools (Lab) page, then return here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                <tr>
                  <th className="pb-2 font-normal">Metric</th>
                  <th className="pb-2 font-normal">Before</th>
                  <th className="pb-2 font-normal">After</th>
                  <th className="pb-2 font-normal">Delta</th>
                </tr>
              </thead>
              <tbody className="text-[var(--ink-muted)]">
                {(
                  [
                    ["P95 build ms", "p95BuildMs"],
                    ["P95 raster ms", "p95RasterMs"],
                    ["P95 frame ms", "p95FrameMs"],
                    ["Rebuild /s", "rebuildRate"],
                    ["Heap MB", "heapMb"],
                    ["Jank ratio", "jankRatio"],
                  ] as const
                ).map(([label, key]) => {
                  const b = before?.[key] ?? null;
                  const a = after?.[key] ?? null;
                  const delta =
                    b != null && a != null
                      ? key === "jankRatio"
                        ? `${(((a as number) - (b as number)) * 100).toFixed(0)} pts`
                        : Number((a as number) - (b as number)).toFixed(2)
                      : "—";
                  return (
                    <tr key={key} className="border-t border-white/5">
                      <td className="py-2 text-[var(--ink)]">{label}</td>
                      <td className="py-2">
                        {b == null
                          ? "—"
                          : key === "jankRatio"
                            ? `${((b as number) * 100).toFixed(0)}%`
                            : b}
                      </td>
                      <td className="py-2">
                        {a == null
                          ? "—"
                          : key === "jankRatio"
                            ? `${((a as number) * 100).toFixed(0)}%`
                            : a}
                      </td>
                      <td className="py-2">{delta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
