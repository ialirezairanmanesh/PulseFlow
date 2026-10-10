"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PerformanceProblem } from "@/lib/types";
import type { ProblemDiff, SavedSession } from "@/lib/session-history";
import {
  compareSessions,
  diffProblems,
  formatDelta,
  orderChronologically,
  pctChange,
  summarizeComparison,
  summarizeProblemDiff,
} from "@/lib/session-history";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = (await res.json()) as { sessions: SavedSession[] };
      setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
    );
  };

  const remove = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSelected((prev) => prev.filter((x) => x !== id));
    await load();
  };

  const picked = sessions.filter((s) => selected.includes(s.id));
  const pair = picked.length === 2 ? orderChronologically(picked[0], picked[1]) : null;
  const before = pair?.[0];
  const after = pair?.[1];
  const comparison = before && after ? compareSessions(before, after) : [];
  const summary = comparison.length > 0 ? summarizeComparison(comparison) : null;
  const problemDiff = before && after ? diffProblems(before, after) : null;
  const problemSummary = problemDiff ? summarizeProblemDiff(problemDiff) : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          History
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Saved sessions on the bridge host — select two to see exactly what your change fixed
          (older is treated as before, newer as after)
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">
          No saved sessions yet — use Save session on the Report page.
        </p>
      ) : (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <ul className="space-y-2 text-sm">
            {sessions.map((s) => {
              const active = selected.includes(s.id);
              const slot = !pair
                ? null
                : pair[0].id === s.id
                  ? "before"
                  : pair[1].id === s.id
                    ? "after"
                    : null;
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    active ? "border-teal-400/40 bg-teal-500/10" : "border-white/8 bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="flex-1 text-left text-[var(--ink-muted)]"
                  >
                    <span className="text-[var(--ink)]">
                      {s.label ?? new Date(s.savedAt).toLocaleString()}
                    </span>
                    {slot && (
                      <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--ink-faint)]">
                        {slot}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-[var(--ink-faint)]">
                      {new Date(s.savedAt).toLocaleString()} · {s.mode ?? "—"} · problems{" "}
                      {s.stats.problemCount} · p95 build {s.stats.p95BuildMs} ms · jank{" "}
                      {(s.stats.jankRatio * 100).toFixed(0)}%
                    </span>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(s.id)}>
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pair && before && after && (
        <section className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="mb-1 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Compare
            </h3>
            <p className="mb-3 text-sm text-[var(--ink-muted)]">
              <span className="text-rose-200/90">before</span>{" "}
              {before.label ?? new Date(before.savedAt).toLocaleString()} →{" "}
              <span className="text-teal-200/90">after</span>{" "}
              {after.label ?? new Date(after.savedAt).toLocaleString()}
            </p>

            <div className="space-y-2">
              {problemSummary && (
                <p
                  className={`rounded-md border px-3 py-2 text-sm ${
                    problemSummary.tone === "good"
                      ? "border-teal-400/20 bg-teal-500/10 text-teal-100"
                      : problemSummary.tone === "bad"
                        ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                        : "border-white/10 bg-white/5 text-[var(--ink-muted)]"
                  }`}
                >
                  {problemSummary.headline}
                </p>
              )}
              {summary && (
                <p
                  className={`rounded-md border px-3 py-2 text-sm ${
                    summary.regressed.length > 0
                      ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                      : summary.improved.length > 0
                        ? "border-teal-400/20 bg-teal-500/10 text-teal-100"
                        : "border-white/10 bg-white/5 text-[var(--ink-muted)]"
                  }`}
                >
                  {summary.headline}
                </p>
              )}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  <tr>
                    <th className="pb-2 font-normal">Metric</th>
                    <th className="pb-2 font-normal">Before</th>
                    <th className="pb-2 font-normal">After</th>
                    <th className="pb-2 font-normal">Delta</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--ink-muted)]">
                  {comparison.map((row) => (
                    <tr key={row.key} className="border-t border-white/5">
                      <td className="py-2 text-[var(--ink)]">{row.label}</td>
                      <td className="py-2">{row.before.toFixed(2)}</td>
                      <td className="py-2">{row.after.toFixed(2)}</td>
                      <td
                        className={`py-2 ${
                          row.delta === 0
                            ? "text-[var(--ink-muted)]"
                            : row.improved
                              ? "text-teal-200"
                              : "text-rose-200"
                        }`}
                      >
                        {row.delta === 0
                          ? "no change"
                          : row.key === "jankRatio"
                            ? formatDelta(row.key, row.delta)
                            : `${formatDelta(row.key, row.delta)} (${pctChange(row.key, row.before, row.after)})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {problemDiff && <ProblemsDiffPanel diff={problemDiff} />}
        </section>
      )}
    </div>
  );
}

function ProblemsDiffPanel({ diff }: { diff: ProblemDiff }) {
  const hasAny = diff.fixed.length > 0 || diff.added.length > 0 || diff.persisting.length > 0;
  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
      <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
        Problems report
      </h3>

      {diff.fixed.length > 0 && (
        <ProblemGroup
          title={`Fixed (${diff.fixed.length})`}
          tone="good"
          icon={<CheckCircle2 className="h-4 w-4 text-teal-300" />}
          problems={diff.fixed.map((p) => ({ problem: p, note: p.action, mark: "✓" }))}
        />
      )}

      {diff.added.length > 0 && (
        <ProblemGroup
          title={`New / regressed (${diff.added.length})`}
          tone="bad"
          icon={<TrendingUp className="h-4 w-4 text-rose-300" />}
          problems={diff.added.map((p) => ({ problem: p, note: p.action, mark: "!" }))}
        />
      )}

      {diff.persisting.length > 0 && (
        <ProblemGroup
          title={`Still open (${diff.persisting.length})`}
          tone="neutral"
          icon={<Minus className="h-4 w-4 text-[var(--ink-faint)]" />}
          problems={diff.persisting.map((row) => ({
            problem: row.after,
            note:
              row.impactDelta === 0
                ? "unchanged priority"
                : row.impactDelta < 0
                  ? `impact ${row.impactDelta} — less urgent`
                  : `impact +${row.impactDelta} — more urgent`,
            improved: row.impactDelta < 0,
            regressed: row.impactDelta > 0,
          }))}
        />
      )}
    </div>
  );
}

function ProblemGroup({
  title,
  tone,
  icon,
  problems,
}: {
  title: string;
  tone: "good" | "bad" | "neutral";
  icon: React.ReactNode;
  problems: {
    problem: PerformanceProblem;
    note: string;
    mark?: string;
    improved?: boolean;
    regressed?: boolean;
  }[];
}) {
  const border =
    tone === "good"
      ? "border-teal-400/20 bg-teal-500/5"
      : tone === "bad"
        ? "border-rose-400/25 bg-rose-500/5"
        : "border-white/10 bg-white/5";
  return (
    <div className={`mb-3 rounded-lg border px-3 py-3 ${border}`}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-[var(--ink)]">{title}</span>
      </div>
      <ul className="space-y-2">
        {problems.map(({ problem, note, mark, improved, regressed }) => (
          <li
            key={problem.id}
            className="rounded-md border border-white/8 bg-black/20 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--ink)]">{problem.title}</span>
              <span className="text-xs text-[var(--ink-faint)]">
                {problem.severity}
                {problem.impact != null ? ` · impact ${problem.impact}` : ""}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{problem.detail}</p>
            <p
              className={`mt-1 text-xs ${
                improved
                  ? "text-teal-200/80"
                  : regressed
                    ? "text-rose-200/80"
                    : "text-[var(--ink-faint)]"
              }`}
            >
              {mark ? `${mark} ` : ""}
              {note}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
