import { describe, expect, it } from "vitest";
import { explainProblem, type ExplainContext } from "@/lib/explain";
import type { PerformanceProblem } from "@/lib/types";

const ctx: ExplainContext = { budgetMs: 16.67, jankRatio: 0.3 };

function problem(overrides: Partial<PerformanceProblem> = {}): PerformanceProblem {
  return {
    id: "p",
    severity: "high",
    kind: "hot_rebuild",
    title: "T",
    detail: "d",
    action: "a",
    ...overrides,
  };
}

describe("explainProblem", () => {
  it("explains a rebuild with cause, share, cost and budget", () => {
    const why = explainProblem(
      problem({
        kind: "hot_rebuild",
        widget: "InvoiceCard",
        route: "/invoices",
        sourceUri: "package:app/invoice.dart",
        sourceLine: 42,
        cause: "InvoiceListState",
        ratePerSec: 22,
        share: 40,
        relatedBuildMs: 12,
        duringJank: true,
      }),
      ctx,
    );
    expect(why).toContain("InvoiceListState");
    expect(why).toContain("InvoiceCard");
    expect(why).toContain("/invoices");
    expect(why).toContain("package:app/invoice.dart:42");
    expect(why).toContain("40.0%");
    expect(why).toContain("16.7 ms");
    expect(why).toMatch(/jank/i);
    expect(why).not.toContain("NaN");
  });

  it("degrades gracefully when magnitudes are missing", () => {
    const why = explainProblem(problem({ widget: "Thing" }), ctx);
    expect(why).not.toContain("NaN");
    expect(why).toContain("Thing");
  });

  it("references the budget for build/raster problems", () => {
    const build = explainProblem(
      problem({ kind: "high_build", relatedBuildMs: 20 }),
      ctx,
    );
    expect(build).toContain("20.0 ms");
    expect(build).toContain("16.7 ms");

    const raster = explainProblem(
      problem({ kind: "high_raster", relatedBuildMs: 25 }),
      ctx,
    );
    expect(raster).toContain("raster");
    expect(raster).toContain("25.0 ms");
  });

  it("falls back to the metric detail for unknown kinds", () => {
    const why = explainProblem(
      problem({ kind: "cpu_hotspot", title: "CPU hotspot: AppState.build", ratePerSec: 22 }),
      ctx,
    );
    expect(why).toContain("AppState.build");
    expect(why).toContain("22.0%");
  });

  it("explains slow HTTP from latencyMs without inventing an event rate", () => {
    const why = explainProblem(
      problem({
        kind: "slow_http",
        title: "Slow HTTP GET /api",
        latencyMs: 2500,
      }),
      ctx,
    );
    expect(why).toContain("2500 ms");
    expect(why).toMatch(/network\/UX/i);
    expect(why).not.toMatch(/\d+\.\d+\/s/);
  });

  it("explains UI stalls as main-thread blocks over threshold", () => {
    const why = explainProblem(
      problem({
        kind: "ui_stall",
        relatedBuildMs: 840,
        route: "/home",
      }),
      ctx,
    );
    expect(why).toContain("840 ms");
    expect(why).toContain("/home");
    expect(why).toMatch(/threshold|freeze/i);
  });
});
