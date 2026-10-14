import { FRAME_BUDGET } from "@/lib/chart-utils";
import { frameDensity, frameSamples, jankRatioOf } from "@/lib/frame-metrics";
import { percentile } from "@/lib/problems";
import type { MetricPoint, PerformanceProblem } from "@/lib/types";

export interface SessionBudgets {
  maxP95BuildMs: number;
  maxP95RasterMs: number;
  maxP95FrameMs: number;
  maxJankRatio: number;
}

export interface BudgetResult {
  key: "p95Build" | "p95Raster" | "p95Frame" | "jank";
  label: string;
  value: number;
  budget: number;
  passed: boolean;
  unit: "ms" | "ratio";
  /** Jank chip only: ratio ignored for pass/fail because samples are sparse/stale. */
  inconclusive?: boolean;
}

export interface HealthVerdict {
  status: "good" | "needs-work" | "bad";
  /** 0 (bad) … 100 (clean). Displayed alongside the budget chips so it is explainable. */
  score: number;
  /** One human sentence: the dominant reason the app is where it is. */
  headline: string;
  /** Up to three short, plain-language reasons. */
  reasons: string[];
  /** Per-metric value vs budget, always present so the score is never a black box. */
  budgets: BudgetResult[];
}

export const DEFAULT_MAX_JANK_RATIO = 0.2;

export interface VerdictInput {
  points: MetricPoint[];
  problems: PerformanceProblem[];
  /** Measured per-frame budget (1000 / refreshRate); falls back to 16.67 ms. */
  budgetMs?: number;
  budgets?: Partial<SessionBudgets>;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function worstBudgetText(b: BudgetResult): string {
  if (b.unit === "ratio") {
    return `${pct(b.value)} of frames missed the frame budget (limit ${pct(b.budget)}) — the app janks under load.`;
  }
  const over = b.value - b.budget;
  return `${b.label} is ${b.value.toFixed(1)} ms against a ${b.budget.toFixed(1)} ms budget — over by ${over.toFixed(1)} ms.`;
}

/**
 * One shared health verdict for the whole session, mirroring the budget semantics
 * of `evaluateBudgets` in the bridge's `check.dart` so the dashboard and the
 * headless CI check agree on pass/fail.
 *
 * Primary gates: P95 build / raster / frame vs device budget.
 * Jank% only fails when frame samples are dense; sparse/stale poll echo is ignored.
 */
export function computeVerdict(input: VerdictInput): HealthVerdict {
  const measured = input.budgetMs ?? input.points.at(-1)?.buildBudgetMs;
  const budgetMs = measured && measured > 0 ? measured : FRAME_BUDGET;
  const maxP95BuildMs = input.budgets?.maxP95BuildMs ?? budgetMs;
  const maxP95RasterMs = input.budgets?.maxP95RasterMs ?? budgetMs;
  const maxP95FrameMs = input.budgets?.maxP95FrameMs ?? budgetMs;
  const maxJankRatio = input.budgets?.maxJankRatio ?? DEFAULT_MAX_JANK_RATIO;

  const frames = frameSamples(input.points);
  const hasSamples = frames.length > 0;
  const density = frameDensity(input.points);
  const p95BuildMs = percentile(
    frames.map((p) => p.buildMs),
    95,
  );
  const p95RasterMs = percentile(
    frames.map((p) => p.rasterMs),
    95,
  );
  const p95FrameMs = percentile(
    frames.map((p) => p.frameMs),
    95,
  );
  const jankRatio = jankRatioOf(input.points);
  const jankInconclusive = density.sparse;
  const jankPassed = jankInconclusive || jankRatio <= maxJankRatio;

  const budgets: BudgetResult[] = [
    {
      key: "p95Build",
      label: "P95 build",
      value: p95BuildMs,
      budget: maxP95BuildMs,
      passed: !hasSamples || p95BuildMs <= maxP95BuildMs,
      unit: "ms",
    },
    {
      key: "p95Raster",
      label: "P95 raster",
      value: p95RasterMs,
      budget: maxP95RasterMs,
      passed: !hasSamples || p95RasterMs <= maxP95RasterMs,
      unit: "ms",
    },
    {
      key: "p95Frame",
      label: "P95 frame",
      value: p95FrameMs,
      budget: maxP95FrameMs,
      passed: !hasSamples || p95FrameMs <= maxP95FrameMs,
      unit: "ms",
    },
    {
      key: "jank",
      label: "Jank ratio",
      value: jankRatio,
      budget: maxJankRatio,
      passed: jankPassed,
      unit: "ratio",
      inconclusive: jankInconclusive,
    },
  ];

  const misses = budgets.filter((b) => !b.passed && !b.inconclusive);
  const high = input.problems.filter((p) => p.severity === "high").length;
  const medium = input.problems.filter((p) => p.severity === "medium").length;

  let score = 100;
  for (const miss of misses) {
    const ratio = miss.budget > 0 ? miss.value / miss.budget : 1;
    score -= Math.min(30, 12 + Math.max(0, ratio - 1) * 20);
  }
  score -= high * 8 + medium * 4;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const status: HealthVerdict["status"] =
    score < 50 || misses.length >= 2
      ? "bad"
      : score < 80 || misses.length === 1
        ? "needs-work"
        : "good";

  const reasons: string[] = [];
  for (const miss of misses) {
    reasons.push(
      miss.unit === "ratio"
        ? `Jank ${pct(miss.value)} > ${pct(miss.budget)}`
        : `${miss.label} ${miss.value.toFixed(1)} ms > ${miss.budget.toFixed(1)} ms`,
    );
  }
  for (const p of input.problems) {
    if (reasons.length >= 3) break;
    if (p.severity === "high") reasons.push(p.title);
  }

  let headline: string;
  const jankLooksInflated = jankInconclusive && jankRatio > maxJankRatio;
  if (jankLooksInflated && misses.length === 0) {
    headline = `Jank ${pct(jankRatio)} looks inflated (sparse / stale poll) — trust P95 frame ${p95FrameMs.toFixed(1)} ms vs ${budgetMs.toFixed(1)} ms budget.`;
  } else if (jankLooksInflated && misses.some((m) => m.key === "p95Frame" || m.key === "p95Build" || m.key === "p95Raster")) {
    const worst = [...misses].sort(
      (a, b) => b.value / (b.budget || 1) - a.value / (a.budget || 1),
    )[0]!;
    headline = `${worstBudgetText(worst)} Jank% ignored (sparse / stale poll).`;
  } else if (misses.length) {
    const worst = [...misses].sort(
      (a, b) => b.value / (b.budget || 1) - a.value / (a.budget || 1),
    )[0]!;
    headline = worstBudgetText(worst);
  } else if (!hasSamples && input.problems.length === 0) {
    headline = "No frame samples yet — interact with the app so PulseFlow can measure.";
  } else if (input.problems.length) {
    headline = `Within frame budget, but ${input.problems.length} issue${
      input.problems.length === 1 ? "" : "s"
    } remain — start with "${input.problems[0]!.title}".`;
  } else {
    headline = "Within budget — no blocking problems found.";
  }

  return { status, score, headline, reasons, budgets };
}
