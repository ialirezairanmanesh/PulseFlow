"use client";

import { toEditorUrl } from "@/lib/editor-link";
import { paretoLine } from "@/lib/impact";
import type { PerformanceProblem } from "@/lib/types";

function severityClass(severity: PerformanceProblem["severity"]) {
  if (severity === "high") return "border-rose-400/30 bg-rose-500/10 text-rose-100";
  if (severity === "medium") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return "border-white/10 bg-white/5 text-[var(--ink-muted)]";
}

function verifyText(p: PerformanceProblem, budgetMs: number): string {
  const budget = budgetMs.toFixed(1);
  switch (p.kind) {
    case "hot_rebuild":
      return "Re-measure after the change — rebuild rate for this widget and P95 build should both drop.";
    case "high_build":
      return `Record again and check P95 build under ${budget} ms.`;
    case "high_raster":
      return `Record again and check P95 raster under ${budget} ms.`;
    case "cpu_hotspot":
      return "Record CPU again and confirm this function's self-time falls.";
    case "slow_http":
      return "Re-time the request — target under 500 ms on the critical path.";
    case "memory_growth":
      return "Capture two fresh snapshots and diff — growth for this class should shrink.";
    case "gc_pressure":
      return "Watch GC events during the same interaction; they should become rarer.";
    case "scenario_jank":
      return "Re-run the same scenario and compare the jank ratio on /report.";
    case "error_overflow":
    case "error_exception":
      return "Re-run the screen — the error count should reach zero.";
    case "missing_probe":
      return "Add the package, hot-restart, reconnect, then confirm rebuild ranks appear.";
    default:
      return "Re-measure the same interaction to confirm the change.";
  }
}

function ProblemMeta({ p }: { p: PerformanceProblem }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] opacity-70">
        {p.kind.replace(/_/g, " ")}
      </span>
      {p.impact != null && (
        <span className="text-[10px] uppercase tracking-[0.14em] opacity-60">
          impact {p.impact}
        </span>
      )}
    </div>
  );
}

function SourceLink({ p }: { p: PerformanceProblem }) {
  const href = p.sourceUri ? toEditorUrl(p.sourceUri, p.sourceLine) : null;
  if (!href) return null;
  return (
    <a
      className="font-mono text-[11px] underline decoration-dotted opacity-80 hover:opacity-100"
      href={href}
    >
      {`${p.sourceUri!.split("/").pop()}${p.sourceLine ? `:${p.sourceLine}` : ""}`}
    </a>
  );
}

export function FixPlan({
  problems,
  budgetMs,
}: {
  problems: PerformanceProblem[];
  budgetMs: number;
}) {
  if (problems.length === 0) return null;
  const [hero, ...rest] = problems;

  return (
    <div className="space-y-3">
      <article className={`rounded-xl border-2 px-4 py-4 ${severityClass(hero.severity)}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              Fix this next
            </div>
            <ProblemMeta p={hero} />
            <h3 className="mt-1 font-[family-name:var(--font-display)] text-xl tracking-tight">
              {hero.title}
            </h3>
          </div>
          <span className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.14em]">
            {hero.severity}
          </span>
        </div>

        <p className="mt-2 text-sm text-[var(--ink)]">{hero.why ?? hero.detail}</p>

        <p className="mt-3 text-sm opacity-90">
          <span className="text-[var(--accent)]">Fix: </span>
          {hero.action}
        </p>

        <p className="mt-1.5 text-sm opacity-80">
          <span className="text-[var(--accent)]">Verify: </span>
          {verifyText(hero, budgetMs)}
        </p>

        {(hero.route || hero.widget || hero.sourceUri) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[12px] opacity-70">
            {hero.route && <span>{hero.route}</span>}
            {hero.route && hero.widget && <span>·</span>}
            {hero.widget && <span>{hero.widget}</span>}
            <SourceLink p={hero} />
          </div>
        )}
      </article>

      {rest.length > 0 && (
        <details className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-sm">
          <summary className="cursor-pointer select-none text-sm text-[var(--ink-muted)]">
            Also worth fixing ({rest.length}) — {paretoLine(problems)}
          </summary>
          <ul className="mt-3 space-y-2">
            {rest.map((p) => (
              <li
                key={p.id}
                className={`rounded-lg border px-3 py-2 text-sm ${severityClass(p.severity)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[var(--ink)]">{p.title}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] opacity-60">
                    {p.severity}
                    {p.impact != null ? ` · impact ${p.impact}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-75">{p.action}</p>
                {p.sourceUri && (
                  <p className="mt-1">
                    <SourceLink p={p} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
