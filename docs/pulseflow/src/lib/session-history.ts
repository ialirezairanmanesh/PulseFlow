import type { PerformanceProblem } from "@/lib/types";

/** A small, serializable snapshot of the headline metrics for a session. */
export interface SessionStats {
  problemCount: number;
  p95BuildMs: number;
  p95RasterMs: number;
  p95FrameMs: number;
  rebuildRate: number;
  heapMb: number;
  jankRatio: number;
}

/** A session persisted to the local history store. */
export interface SavedSession {
  id: string;
  savedAt: number;
  label?: string;
  mode?: string;
  isolateName?: string;
  stats: SessionStats;
  /** Ranked problems captured at save time, used to diff before/after fixes. */
  problems?: PerformanceProblem[];
  report: unknown;
}

export interface ComparisonRow {
  key: keyof SessionStats;
  label: string;
  before: number;
  after: number;
  delta: number;
  improved: boolean;
}

export const SESSION_STAT_LABELS: ReadonlyArray<[keyof SessionStats, string]> = [
  ["p95BuildMs", "P95 build ms"],
  ["p95RasterMs", "P95 raster ms"],
  ["p95FrameMs", "P95 frame ms"],
  ["rebuildRate", "Rebuild /s"],
  ["heapMb", "Heap MB"],
  ["jankRatio", "Jank ratio"],
  ["problemCount", "Problems"],
];

/** Compares two sessions stat-by-stat (delta = after - before; lower is better). */
export function compareSessions(before: SavedSession, after: SavedSession): ComparisonRow[] {
  return SESSION_STAT_LABELS.map(([key, label]) => {
    const b = before.stats[key];
    const a = after.stats[key];
    const delta = a - b;
    return { key, label, before: b, after: a, delta, improved: delta < 0 };
  });
}

export function formatDelta(key: keyof SessionStats, delta: number): string {
  if (key === "jankRatio") return `${(delta * 100).toFixed(1)} pts`;
  return delta.toFixed(2);
}

/** Percent change from before → after; jank ratio is expressed in points instead. */
export function pctChange(key: keyof SessionStats, before: number, after: number): string {
  if (key === "jankRatio") {
    const delta = (after - before) * 100;
    return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts`;
  }
  if (before === 0) return after === 0 ? "0%" : "new";
  const pct = ((after - before) / Math.abs(before)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

export interface ComparisonSummary {
  improved: ComparisonRow[];
  regressed: ComparisonRow[];
  headline: string;
}

/** A one-line verdict for a before/after comparison (lower is better). */
export function summarizeComparison(rows: ComparisonRow[]): ComparisonSummary {
  const improved = rows.filter((r) => r.delta !== 0 && r.improved);
  const regressed = rows.filter((r) => r.delta !== 0 && !r.improved);
  let headline: string;
  if (rows.length === 0) {
    headline = "No comparison data.";
  } else if (improved.length && regressed.length) {
    headline = `Mixed: ${improved.length} metric${improved.length === 1 ? "" : "s"} improved, ${regressed.length} regressed.`;
  } else if (regressed.length) {
    headline = `Regression: ${regressed
      .map((r) => r.label)
      .slice(0, 3)
      .join(", ")} got worse.`;
  } else if (improved.length) {
    headline = `Improved: ${improved.length} of ${rows.length} metrics better.`;
  } else {
    headline = "No significant change.";
  }
  return { improved, regressed, headline };
}

/**
 * Orders two sessions chronologically so the older one is treated as "before"
 * and the newer one as "after", regardless of selection order.
 */
export function orderChronologically(a: SavedSession, b: SavedSession): [SavedSession, SavedSession] {
  return a.savedAt <= b.savedAt ? [a, b] : [b, a];
}

/** A problem that exists in both sessions, tracked with its impact movement. */
export interface PersistingProblem {
  id: string;
  before: PerformanceProblem;
  after: PerformanceProblem;
  /** after.impact - before.impact (negative = lower priority = improved). */
  impactDelta: number;
}

/** The stat-by-stat fix report: what disappeared, what appeared, what remains. */
export interface ProblemDiff {
  fixed: PerformanceProblem[];
  added: PerformanceProblem[];
  persisting: PersistingProblem[];
}

function impactOf(p: PerformanceProblem): number {
  return p.impact ?? 0;
}

function byImpactDesc(a: PerformanceProblem, b: PerformanceProblem): number {
  return impactOf(b) - impactOf(a);
}

/**
 * Compares the ranked problems of two sessions by their stable `id`.
 * Problems present only in `before` were fixed; only in `after` are new;
 * present in both are persisting (with an impact delta).
 */
export function diffProblems(before: SavedSession, after: SavedSession): ProblemDiff {
  const beforeProblems = before.problems ?? [];
  const afterProblems = after.problems ?? [];
  const beforeById = new Map(beforeProblems.map((p) => [p.id, p]));
  const afterById = new Map(afterProblems.map((p) => [p.id, p]));

  const fixed = beforeProblems.filter((p) => !afterById.has(p.id)).sort(byImpactDesc);
  const added = afterProblems.filter((p) => !beforeById.has(p.id)).sort(byImpactDesc);
  const persisting: PersistingProblem[] = beforeProblems
    .filter((p) => afterById.has(p.id))
    .map((b) => {
      const a = afterById.get(b.id)!;
      return { id: b.id, before: b, after: a, impactDelta: impactOf(a) - impactOf(b) };
    })
    .sort((x, y) => x.impactDelta - y.impactDelta);

  return { fixed, added, persisting };
}

export interface ProblemDiffSummary {
  headline: string;
  tone: "good" | "bad" | "neutral";
}

/** A one-line verdict for the problem fix report. */
export function summarizeProblemDiff(diff: ProblemDiff): ProblemDiffSummary {
  const { fixed, added, persisting } = diff;
  const improved = persisting.filter((p) => p.impactDelta < 0).length;
  const worsened = persisting.filter((p) => p.impactDelta > 0).length;

  if (fixed.length === 0 && added.length === 0 && persisting.length === 0) {
    return { headline: "No problems captured in either session.", tone: "neutral" };
  }
  if (fixed.length > 0 && added.length === 0) {
    return {
      headline: `Fixed ${fixed.length} problem${fixed.length === 1 ? "" : "s"}${
        persisting.length > 0 ? `, ${persisting.length} still open` : " — all clear"
      }.`,
      tone: "good",
    };
  }
  if (added.length > 0 && fixed.length === 0) {
    return {
      headline: `Regression: ${added.length} new problem${added.length === 1 ? "" : "s"} appeared.`,
      tone: "bad",
    };
  }
  if (fixed.length > 0 && added.length > 0) {
    return {
      headline: `Mixed: fixed ${fixed.length}, but ${added.length} new appeared.`,
      tone: added.length > fixed.length ? "bad" : "neutral",
    };
  }
  return {
    headline:
      improved > 0 && worsened === 0
        ? `${improved} problem${improved === 1 ? "" : "s"} got cheaper, none regressed.`
        : `${persisting.length} problem${persisting.length === 1 ? "" : "s"} still open.`,
    tone: "neutral",
  };
}
