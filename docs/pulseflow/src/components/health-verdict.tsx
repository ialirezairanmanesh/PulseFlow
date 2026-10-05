"use client";

import { Badge } from "@/components/ui/badge";
import type { BudgetResult, HealthVerdict } from "@/lib/verdict";

const STATUS_META: Record<
  HealthVerdict["status"],
  { label: string; variant: "live" | "mock" | "error"; ring: string; score: string }
> = {
  good: {
    label: "Healthy",
    variant: "live",
    ring: "border-teal-400/25 bg-teal-500/10",
    score: "text-teal-200",
  },
  "needs-work": {
    label: "Needs work",
    variant: "mock",
    ring: "border-amber-400/25 bg-amber-500/10",
    score: "text-amber-200",
  },
  bad: {
    label: "Problems",
    variant: "error",
    ring: "border-rose-400/25 bg-rose-500/10",
    score: "text-rose-200",
  },
};

function budgetValue(b: BudgetResult): string {
  return b.unit === "ratio"
    ? `${(b.value * 100).toFixed(0)}% / ${(b.budget * 100).toFixed(0)}%`
    : `${b.value.toFixed(1)} / ${b.budget.toFixed(1)} ms`;
}

export function HealthVerdict({ verdict }: { verdict: HealthVerdict }) {
  const meta = STATUS_META[verdict.status];

  return (
    <section
      className={`rounded-xl border px-4 py-4 backdrop-blur-sm ${meta.ring}`}
      aria-label="Session health verdict"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              session verdict
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink)]">{verdict.headline}</p>
          {verdict.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--ink-muted)]">
              {verdict.reasons.map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="text-right">
          <div className={`font-[family-name:var(--font-display)] text-4xl tracking-tight ${meta.score}`}>
            {verdict.score}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            health score
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {verdict.budgets.map((b) => (
          <div
            key={b.key}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
              b.passed
                ? "border-teal-400/20 bg-teal-500/10 text-teal-100"
                : "border-rose-400/25 bg-rose-500/10 text-rose-100"
            }`}
            title={`${b.label}: ${b.passed ? "within budget" : "over budget"}`}
          >
            <span className="text-[10px] uppercase tracking-[0.12em] opacity-70">{b.label}</span>
            <span className="font-mono">{budgetValue(b)}</span>
            <span aria-hidden>{b.passed ? "✓" : "✕"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
