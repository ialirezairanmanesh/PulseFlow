import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_JANK_RATIO, computeVerdict } from "@/lib/verdict";
import type { PerformanceProblem } from "@/lib/types";
import { point } from "./helpers";

function problem(overrides: Partial<PerformanceProblem> = {}): PerformanceProblem {
  return {
    id: "p",
    severity: "medium",
    kind: "hot_rebuild",
    title: "A widget rebuilds a lot",
    detail: "detail",
    action: "action",
    ...overrides,
  };
}

describe("computeVerdict", () => {
  it("is healthy when within budget with no problems", () => {
    const verdict = computeVerdict({
      points: [point({ buildMs: 4, rasterMs: 3 })],
      problems: [],
    });
    expect(verdict.status).toBe("good");
    expect(verdict.score).toBe(100);
    expect(verdict.budgets.every((b) => b.passed)).toBe(true);
  });

  it("needs work with a single budget miss", () => {
    const verdict = computeVerdict({
      points: [point({ buildMs: 22, rasterMs: 3 })],
      problems: [],
    });
    expect(verdict.status).toBe("needs-work");
    expect(verdict.budgets.find((b) => b.key === "p95Build")?.passed).toBe(false);
    expect(verdict.headline).toMatch(/P95 build/);
  });

  it("is bad with two budget misses", () => {
    const verdict = computeVerdict({
      points: [point({ buildMs: 22, rasterMs: 22 })],
      problems: [],
    });
    expect(verdict.status).toBe("bad");
  });

  it("uses the measured 120 Hz budget", () => {
    const at60 = computeVerdict({ points: [point({ buildMs: 9 })], problems: [] });
    const at120 = computeVerdict({
      points: [point({ buildMs: 9, buildBudgetMs: 8.33 })],
      problems: [],
    });
    expect(at60.budgets.find((b) => b.key === "p95Build")?.passed).toBe(true);
    expect(at120.budgets.find((b) => b.key === "p95Build")?.passed).toBe(false);
  });

  it("flags a high jank ratio against the default ceiling", () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      point({ buildMs: 5, jank: i < 4 ? 1 : 0 }),
    );
    const verdict = computeVerdict({ points, problems: [] });
    const jank = verdict.budgets.find((b) => b.key === "jank");
    expect(jank?.budget).toBe(DEFAULT_MAX_JANK_RATIO);
    expect(jank?.passed).toBe(false);
  });

  it("lowers the score as problems accumulate", () => {
    const none = computeVerdict({ points: [point({ buildMs: 4 })], problems: [] });
    const some = computeVerdict({
      points: [point({ buildMs: 4 })],
      problems: [
        problem({ severity: "high" }),
        problem({ id: "p2", severity: "high" }),
        problem({ id: "p3", severity: "medium" }),
      ],
    });
    expect(some.score).toBeLessThan(none.score);
  });

  it("is idle-safe with no samples", () => {
    const verdict = computeVerdict({ points: [], problems: [] });
    expect(verdict.status).toBe("good");
    expect(verdict.headline).toMatch(/No frame samples/);
  });
});
