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
      const where =
        p.widget && p.route && p.route !== "(unnamed)"
          ? `\`${p.widget}\` on ${p.route}`
          : p.widget
            ? `\`${p.widget}\`${p.route === "(unnamed)" ? " on an unnamed route" : ""}`
            : "this widget";
      const source =
        p.sourceUri != null
          ? ` (${p.sourceUri}${p.sourceLine != null ? `:${p.sourceLine}` : ""})`
          : "";
      // relatedBuildMs on rebuilds is rare and must not imply per-widget additive cost.
      const cost = p.relatedBuildMs
        ? ` Coincides with ~${ms(p.relatedBuildMs)} build on recent frames (session-wide, not this widget alone) vs a ${budget} ms budget`
        : "";
      const consequence = p.duringJank
        ? ", and it lands on janky frames — that is why you see dropped frames while interacting."
        : " — a rebuild hotspot; confirm whether it coincides with jank before prioritizing.";
      return `${cause}${where}${source} rebuilds ${fmt(p.ratePerSec)}×/s — ${fmt(
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
      const latency = p.latencyMs ?? 0;
      const ratio = latency > 0 ? latency / 500 : 0;
      return `${p.title} — ${ms(latency, 0)}${
        ratio >= 1 ? `, about ${ratio.toFixed(1)}× the 500 ms healthy ceiling` : ""
      }. This is network/UX wait time; it does not by itself mean high build ms unless rebuilds fire when the response lands.`;
    }

    case "scenario_jank":
      return `${p.detail} The scenario reproduced real jank, so it is a reliable way to verify a fix.`;

    case "error_overflow":
      return `A layout overflows${p.route ? ` on ${p.route}` : ""} — the row/column is wider or taller than its parent, so paint is clipped or flagged every frame.`;

    case "error_exception":
      return `An exception fires${p.route ? ` on ${p.route}` : ""} — uncaught errors often mask state bugs and can stall frames.`;

    case "missing_probe":
      return "The widget probe is not registered, so rebuild ranks, causes, and source locations stay empty until it is added.";

    case "ui_stall":
      return `Main thread blocked for up to ${ms(p.relatedBuildMs, 0)}${
        p.route ? ` (last seen on ${p.route})` : ""
      } — longer than the stall threshold, so frames and input freeze until the isolate resumes.`;

    default:
      return p.detail;
  }
}
