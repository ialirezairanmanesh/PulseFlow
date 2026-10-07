/**
 * Per-widget problem heat: match ranked problems onto rebuild rows and derive
 * a score for stable sorting + visual intensity on the Widgets page.
 */
import type { PerformanceProblem, WidgetRebuildStat } from "@/lib/types";

const SEV_WEIGHT = { high: 3, medium: 2, low: 1 } as const;

export type WidgetHeat = {
  problems: PerformanceProblem[];
  count: number;
  /** Higher = fix sooner. Combines matched problems + rebuild pressure. */
  score: number;
  maxSeverity: PerformanceProblem["severity"] | null;
};

export function problemsForWidget(
  problems: PerformanceProblem[],
  w: Pick<WidgetRebuildStat, "name" | "route">,
): PerformanceProblem[] {
  return problems.filter((p) => {
    if (!p.widget || p.widget !== w.name) return false;
    if (!p.route) return true;
    return p.route === w.route;
  });
}

export function widgetHeat(
  w: WidgetRebuildStat,
  problems: PerformanceProblem[],
): WidgetHeat {
  const matched = problemsForWidget(problems, w);
  let score = matched.reduce(
    (sum, p) => sum + SEV_WEIGHT[p.severity] * 12 + (p.impact ?? 0) / 8,
    0,
  );
  if (w.duringJank) score += 6;
  if (w.ratePerSec >= 15) score += 10;
  else if (w.ratePerSec >= 8) score += 5;
  else if (w.ratePerSec >= 3) score += 2;
  if (w.share >= 35) score += 8;
  else if (w.share >= 20) score += 4;

  let maxSeverity: PerformanceProblem["severity"] | null = null;
  for (const p of matched) {
    if (!maxSeverity || SEV_WEIGHT[p.severity] > SEV_WEIGHT[maxSeverity]) {
      maxSeverity = p.severity;
    }
  }
  if (!maxSeverity) {
    if (w.ratePerSec >= 15 || w.share >= 35) maxSeverity = "high";
    else if (w.ratePerSec >= 8 || w.share >= 20) maxSeverity = "medium";
    else if (w.ratePerSec >= 3 || w.share >= 8) maxSeverity = "low";
  }

  return { problems: matched, count: matched.length, score, maxSeverity };
}

/** Stable sort: hottest first, then alphabetical so rows don't jitter on tiny rate changes. */
export function compareByHeatThenName(
  a: { heat: WidgetHeat; name: string },
  b: { heat: WidgetHeat; name: string },
): number {
  if (b.heat.score !== a.heat.score) return b.heat.score - a.heat.score;
  return a.name.localeCompare(b.name);
}

/**
 * Escalating rose wash for table rows. Intensity scales with problem count and
 * rebuild pressure so multi-issue widgets read as visibly hotter.
 */
export function heatRowClass(heat: WidgetHeat): string {
  if (heat.score <= 0 && heat.count === 0) return "";
  if (heat.count >= 3 || heat.score >= 40 || heat.maxSeverity === "high") {
    return "bg-rose-500/25 border-l-2 border-l-rose-400";
  }
  if (heat.count >= 2 || heat.score >= 22 || heat.maxSeverity === "medium") {
    return "bg-rose-500/15 border-l-2 border-l-rose-400/70";
  }
  if (heat.count >= 1 || heat.score >= 10 || heat.maxSeverity === "low") {
    return "bg-rose-500/8 border-l-2 border-l-rose-400/40";
  }
  return "";
}

export function heatBadgeClass(heat: WidgetHeat): string {
  if (heat.count >= 3 || heat.maxSeverity === "high") {
    return "border-rose-400/50 bg-rose-500/30 text-rose-50";
  }
  if (heat.count >= 2 || heat.maxSeverity === "medium") {
    return "border-rose-400/35 bg-rose-500/20 text-rose-100";
  }
  if (heat.count >= 1) {
    return "border-rose-400/25 bg-rose-500/12 text-rose-100/90";
  }
  return "border-white/10 bg-white/5 text-[var(--ink-faint)]";
}
