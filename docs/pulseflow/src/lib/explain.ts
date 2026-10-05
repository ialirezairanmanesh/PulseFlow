import type { PerformanceProblem } from "@/lib/types";

export interface ExplainContext {
  /** Per-frame budget in ms (1000 / refreshRate). */
  budgetMs: number;
  /** Fraction of recent frames that missed the budget (0..1). */
  jankRatio: number;
}

function fmt(value: number | undefined, digits = 1): string {
  return Number.isFinite(value) ? (value as number).toFixed(digits) : "—";
}

function ms(value: number | undefined, digits = 1): string {
  return `${fmt(value, digits)} ms`;
}

/**
 * Builds one plain-language cause → effect sentence for a problem from the data
 * it already carries. Falls back to the metric `detail` when there is not enough
 * context to explain (e.g. profile builds without rebuild causes).
 */
export function explainProblem(p: PerformanceProblem, ctx: ExplainContext): string {
  const budget = ctx.budgetMs > 0 ? fmt(ctx.budgetMs) : "16.7";

  switch (p.kind) {
    case "hot_rebuild": {
      const cause =
        p.cause && p.cause !== p.widget ? `Because ${p.cause} rebuilds, ` : "";
      const cost = p.relatedBuildMs
        ? ` That build costs about ${ms(p.relatedBuildMs)} per frame against a ${budget} ms budget`
        : "";
      const consequence = p.duringJank
        ? ", and it lands on janky frames — that is why you see dropped frames while interacting."
        : ", so frames get close to the budget.";
      return `${cause}${p.widget ?? "this widget"} rebuilds ${fmt(p.ratePerSec)}×/s — ${fmt(
        p.share,
      )}% of all rebuilds.${cost}${consequence}`;
    }

    case "high_build":
      return `Frames spend ${ms(p.relatedBuildMs)} in build/layout — over the ${budget} ms budget, so widgets are doing too much work before paint.`;

    case "high_raster":
      return `Frames spend ${ms(p.relatedBuildMs)} in raster — over the ${budget} ms budget; paint, shadows, blur, opacity, or oversized images are the cost.`;

    case "cpu_hotspot": {
      const fn = p.title.replace(/^CPU hotspot:\s*/i, "");
      return `${fn} burns ${fmt(p.ratePerSec)}% of CPU self-time${
        p.duringJank ? " and shows up on janky frames" : ""
      } — that is synchronous work on the UI isolate.`;
    }

    case "gc_pressure":
      return `${p.detail} Short-lived allocations are churning — temp lists, image decodes, or large string builds are the usual cause.`;

    case "memory_growth":
      return `${p.detail} A class that only grows usually means a cache, listener, or list that is never released.`;

    case "slow_http": {
      const ratio = p.ratePerSec ? p.ratePerSec / 500 : 0;
      return `${p.title} — ${ms(p.ratePerSec, 0)}${
        ratio >= 1 ? `, about ${ratio.toFixed(1)}× the 500 ms healthy ceiling` : ""
      }. It blocks whatever waits on the response.`;
    }

    case "scenario_jank":
      return `${p.detail} The scenario reproduced real jank, so it is a reliable way to verify a fix.`;

    case "error_overflow":
      return `A layout overflows${p.route ? ` on ${p.route}` : ""} — the row/column is wider or taller than its parent, so paint is clipped or flagged every frame.`;

    case "error_exception":
      return `An exception fires${p.route ? ` on ${p.route}` : ""} — uncaught errors often mask state bugs and can stall frames.`;

    case "missing_probe":
      return "The widget probe is not registered, so rebuild ranks, causes, and source locations stay empty until it is added.";

    default:
      return p.detail;
  }
}
