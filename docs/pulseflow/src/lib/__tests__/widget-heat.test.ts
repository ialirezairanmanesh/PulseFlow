import { describe, expect, it } from "vitest";
import {
  compareByHeatThenName,
  heatRowClass,
  problemsForWidget,
  widgetHeat,
} from "@/lib/widget-heat";
import type { PerformanceProblem } from "@/lib/types";
import { widget } from "./helpers";

function problem(overrides: Partial<PerformanceProblem> = {}): PerformanceProblem {
  return {
    id: "p1",
    severity: "medium",
    kind: "hot_rebuild",
    title: "rebuilds heavily",
    detail: "detail",
    action: "fix",
    widget: "InvoiceCard",
    route: "/invoices",
    ...overrides,
  };
}

describe("problemsForWidget", () => {
  it("matches by name and route", () => {
    const problems = [
      problem({ widget: "InvoiceCard", route: "/invoices" }),
      problem({ id: "p2", widget: "InvoiceCard", route: "/other" }),
      problem({ id: "p3", widget: "Other", route: "/invoices" }),
    ];
    const matched = problemsForWidget(problems, {
      name: "InvoiceCard",
      route: "/invoices",
    });
    expect(matched).toHaveLength(1);
    expect(matched[0]!.id).toBe("p1");
  });
});

describe("widgetHeat", () => {
  it("scores higher with more / hotter problems", () => {
    const w = widget({ name: "InvoiceCard", route: "/invoices", ratePerSec: 5, share: 10 });
    const one = widgetHeat(w, [problem({ severity: "medium" })]);
    const two = widgetHeat(w, [
      problem({ severity: "high", id: "a" }),
      problem({ severity: "medium", id: "b", title: "second" }),
    ]);
    expect(two.count).toBe(2);
    expect(two.score).toBeGreaterThan(one.score);
    expect(two.maxSeverity).toBe("high");
    expect(heatRowClass(two)).toContain("rose");
  });

  it("sorts stably by heat then name", () => {
    const a = { heat: widgetHeat(widget({ name: "A", ratePerSec: 20, share: 40 }), []), name: "A" };
    const b = { heat: widgetHeat(widget({ name: "B", ratePerSec: 2, share: 1 }), []), name: "B" };
    expect(compareByHeatThenName(a, b)).toBeLessThan(0);
  });
});
