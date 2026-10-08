import type { PerformanceProblem } from "@/lib/types";

export interface ImpactContext {
  /** Per-frame budget in ms (1000 / refreshRate). */
  budgetMs: number;
  /** Fraction of recent frames that missed the budget (0..1). */
  jankRatio: number;
}

const SEVERITY_BASE: Record<PerformanceProblem["severity"], number> = {
  high: 62,
  medium: 36,
  low: 16,
};

const severityRank = { high: 0, medium: 1, low: 2 } as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function magnitude(p: PerformanceProblem, ctx: ImpactContext): number {
  switch (p.kind) {
    case "hot_rebuild":
      return clamp01((p.share ?? 0) / 50);
    case "cpu_hotspot":
      return clamp01((p.ratePerSec ?? 0) / 30);
    case "slow_http":
      // latencyMs only — never treat ratePerSec as latency.
      return clamp01(((p.latencyMs ?? 0) - 500) / 3500);
    case "error_overflow":
    case "error_exception":
      return clamp01((p.ratePerSec ?? 0) / 10);
    case "scenario_jank":
      return clamp01(ctx.jankRatio);
    case "ui_stall":
      return clamp01((p.relatedBuildMs ?? 0) / 2000);
    case "gc_pressure":
      return 0.6;
    case "missing_probe":
      return 0.8;
    case "high_build":
    case "high_raster":
      return clamp01((p.relatedBuildMs ?? 0) / (ctx.budgetMs * 1.5));
    case "memory_growth":
      return 0.7;
    default:
      return 0.5;
  }
}

function jankBoost(p: PerformanceProblem, ctx: ImpactContext): number {
  if (
    p.kind === "hot_rebuild" ||
    p.kind === "cpu_hotspot" ||
    p.kind === "scenario_jank" ||
    p.kind === "ui_stall"
  ) {
    if (p.duringJank || p.kind === "ui_stall") return 1;
    return clamp01(ctx.jankRatio);
  }
  return 0;
}

/**
 * A normalized 0–100 priority for a problem, so "fix first" is comparable across
 * kinds. Blends the severity base with magnitude vs budget, jank correlation,
 * and frame cost (only when relatedBuildMs is set — typically high_build/raster).
 */
export function computeImpact(p: PerformanceProblem, ctx: ImpactContext): number {
  const base = SEVERITY_BASE[p.severity] ?? 20;
  const mag = magnitude(p, ctx) * 22;
  const jank = jankBoost(p, ctx) * 12;
  const cost = clamp01((p.relatedBuildMs ?? 0) / (ctx.budgetMs * 1.5)) * 8;
  return Math.round(Math.max(0, Math.min(100, base + mag + jank + cost)));
}

/**
 * Sets `impact` on every problem and ranks them: severity bucket first (so
 * errors/overflow stay on top), then impact descending.
 */
export function attachImpact(
  problems: PerformanceProblem[],
  ctx: ImpactContext,
): PerformanceProblem[] {
  const scored = problems.map((p) => ({ ...p, impact: computeImpact(p, ctx) }));
  scored.sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (b.impact ?? 0) - (a.impact ?? 0);
  });
  return scored;
}

/**
 * "Top 3 of N problems account for X% of measured impact." Empty when there is
 * nothing meaningful to summarise.
 */
export function paretoLine(problems: PerformanceProblem[], top = 3): string {
  if (problems.length < 2) return "";
  const total = problems.reduce((sum, p) => sum + (p.impact ?? 0), 0);
  if (total <= 0) return "";
  const topSum = [...problems]
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0))
    .slice(0, top)
    .reduce((sum, p) => sum + (p.impact ?? 0), 0);
  const pct = Math.round((topSum / total) * 100);
  const n = Math.min(top, problems.length);
  return `Top ${n} of ${problems.length} problems account for ${pct}% of measured impact.`;
}
