import { describe, expect, it } from "vitest";
import { attachImpact, computeImpact, paretoLine, type ImpactContext } from "@/lib/impact";
import type { PerformanceProblem } from "@/lib/types";

const ctx: ImpactContext = { budgetMs: 16.67, jankRatio: 0.3 };

function problem(overrides: Partial<PerformanceProblem> = {}): PerformanceProblem {
  return {
    id: "p",
    severity: "medium",
    kind: "hot_rebuild",
    title: "T",
    detail: "d",
    action: "a",
    ...overrides,
  };
}

describe("computeImpact", () => {
  it("ranks a high-severity problem above an otherwise identical medium one", () => {
    const high = computeImpact(problem({ severity: "high" }), ctx);
    const medium = computeImpact(problem({ severity: "medium" }), ctx);
    expect(high).toBeGreaterThan(medium);
  });

  it("scales with rebuild share", () => {
    const small = computeImpact(problem({ share: 10 }), ctx);
    const large = computeImpact(problem({ share: 45 }), ctx);
    expect(large).toBeGreaterThan(small);
  });

  it("boosts problems seen during jank", () => {
    const calm = computeImpact(problem({ share: 20, duringJank: false }), ctx);
    const janky = computeImpact(problem({ share: 20, duringJank: true }), ctx);
    expect(janky).toBeGreaterThan(calm);
  });

  it("stays within 0..100", () => {
    const impact = computeImpact(
      problem({ severity: "high", share: 90, duringJank: true, relatedBuildMs: 40 }),
      ctx,
    );
    expect(impact).toBeGreaterThanOrEqual(0);
    expect(impact).toBeLessThanOrEqual(100);
  });
});

describe("attachImpact", () => {
  it("keeps severity as the primary key and impact as the tie-break", () => {
    const ranked = attachImpact(
      [
        problem({ id: "low-high", kind: "hot_rebuild", severity: "medium", share: 5 }),
        problem({ id: "medium-high", kind: "hot_rebuild", severity: "medium", share: 45 }),
        problem({ id: "high-low", kind: "error_overflow", severity: "high" }),
      ],
      ctx,
    );
    expect(ranked[0].severity).toBe("high");
    expect(ranked[1].id).toBe("medium-high");
    expect(ranked[2].id).toBe("low-high");
    expect(ranked.every((p) => typeof p.impact === "number")).toBe(true);
  });
});

describe("paretoLine", () => {
  it("summarises the top contributors", () => {
    const line = paretoLine(
      attachImpact(
        [
          problem({ id: "a", share: 45 }),
          problem({ id: "b", share: 30 }),
          problem({ id: "c", share: 5 }),
        ],
        ctx,
      ),
    );
    expect(line).toContain("Top 3 of 3");
  });

  it("is empty for a single problem", () => {
    expect(paretoLine([problem()])).toBe("");
  });
});
