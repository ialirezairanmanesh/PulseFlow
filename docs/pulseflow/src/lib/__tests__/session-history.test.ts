import { describe, expect, it } from "vitest";
import type { PerformanceProblem } from "@/lib/types";
import type { SavedSession, SessionStats } from "@/lib/session-history";
import {
  compareSessions,
  diffProblems,
  formatDelta,
  orderChronologically,
  pctChange,
  summarizeComparison,
  summarizeProblemDiff,
} from "@/lib/session-history";

function problem(id: string, impact: number, extra: Partial<PerformanceProblem> = {}): PerformanceProblem {
  return {
    id,
    severity: impact >= 50 ? "high" : impact >= 25 ? "medium" : "low",
    kind: "hot_rebuild",
    title: `Problem ${id}`,
    detail: "detail",
    action: "action",
    impact,
    ...extra,
  };
}

function session(id: string, stats: Partial<SessionStats>, problems?: PerformanceProblem[]): SavedSession {
  return {
    id,
    savedAt: 0,
    stats: {
      problemCount: 0,
      p95BuildMs: 0,
      p95RasterMs: 0,
      p95FrameMs: 0,
      rebuildRate: 0,
      heapMb: 0,
      jankRatio: 0,
      ...stats,
    },
    problems,
    report: null,
  };
}

describe("compareSessions", () => {
  it("computes deltas and marks improvements", () => {
    const before = session("a", { p95BuildMs: 12, jankRatio: 0.4, problemCount: 5 });
    const after = session("b", { p95BuildMs: 8, jankRatio: 0.2, problemCount: 3 });

    const rows = compareSessions(before, after);
    const build = rows.find((r) => r.key === "p95BuildMs");
    const jank = rows.find((r) => r.key === "jankRatio");

    expect(build?.delta).toBe(-4);
    expect(build?.improved).toBe(true);
    expect(jank?.delta).toBeCloseTo(-0.2, 5);
    expect(jank?.improved).toBe(true);
  });

  it("marks regressions as not improved", () => {
    const before = session("a", { heapMb: 40 });
    const after = session("b", { heapMb: 55 });
    const heap = compareSessions(before, after).find((r) => r.key === "heapMb");
    expect(heap?.improved).toBe(false);
  });
});

describe("formatDelta", () => {
  it("renders jank ratio as points", () => {
    expect(formatDelta("jankRatio", -0.2)).toBe("-20.0 pts");
  });

  it("renders other metrics as decimals", () => {
    expect(formatDelta("p95BuildMs", -4)).toBe("-4.00");
  });
});

describe("pctChange", () => {
  it("expresses frame metrics as a signed percentage", () => {
    expect(pctChange("p95BuildMs", 12, 8)).toBe("-33%");
  });

  it("expresses the jank ratio as points", () => {
    expect(pctChange("jankRatio", 0.4, 0.2)).toBe("-20.0 pts");
  });

  it("handles a zero baseline", () => {
    expect(pctChange("problemCount", 0, 3)).toBe("new");
    expect(pctChange("problemCount", 0, 0)).toBe("0%");
  });
});

describe("summarizeComparison", () => {
  it("banners an overall improvement", () => {
    const before = session("a", { p95BuildMs: 12, jankRatio: 0.4 });
    const after = session("b", { p95BuildMs: 8, jankRatio: 0.2 });
    const summary = summarizeComparison(compareSessions(before, after));
    expect(summary.regressed).toHaveLength(0);
    expect(summary.headline).toMatch(/Improved/);
  });

  it("banners a regression", () => {
    const before = session("a", { heapMb: 40 });
    const after = session("b", { heapMb: 55 });
    const summary = summarizeComparison(compareSessions(before, after));
    expect(summary.improved).toHaveLength(0);
    expect(summary.headline).toMatch(/Regression/);
  });

  it("reports mixed movement", () => {
    const before = session("a", { p95BuildMs: 12, heapMb: 40 });
    const after = session("b", { p95BuildMs: 8, heapMb: 55 });
    const summary = summarizeComparison(compareSessions(before, after));
    expect(summary.headline).toMatch(/Mixed/);
  });
});

describe("orderChronologically", () => {
  it("puts the older session first regardless of argument order", () => {
    const older = { ...session("old", {}), savedAt: 100 };
    const newer = { ...session("new", {}), savedAt: 200 };
    expect(orderChronologically(newer, older).map((s) => s.id)).toEqual(["old", "new"]);
    expect(orderChronologically(older, newer).map((s) => s.id)).toEqual(["old", "new"]);
  });
});

describe("diffProblems", () => {
  it("classifies fixed, new, and persisting problems by id", () => {
    const before = session("b", {}, [
      problem("a", 60),
      problem("b", 40),
      problem("c", 20),
    ]);
    const after = session("a", {}, [problem("b", 30), problem("c", 20), problem("d", 90)]);

    const diff = diffProblems(before, after);
    expect(diff.fixed.map((p) => p.id)).toEqual(["a"]);
    expect(diff.added.map((p) => p.id)).toEqual(["d"]);
    expect(diff.persisting.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("computes the impact delta for persisting problems", () => {
    const before = session("b", {}, [problem("a", 100)]);
    const after = session("a", {}, [problem("a", 25)]);
    const diff = diffProblems(before, after);
    expect(diff.persisting[0].impactDelta).toBe(-75);
  });

  it("sorts fixed and added groups by impact descending", () => {
    const before = session("b", {}, [problem("low", 10), problem("high", 90)]);
    const after = session("a", {}, [problem("mid", 50), problem("top", 99)]);
    const diff = diffProblems(before, after);
    expect(diff.fixed.map((p) => p.id)).toEqual(["high", "low"]);
    expect(diff.added.map((p) => p.id)).toEqual(["top", "mid"]);
  });

  it("treats missing problem lists as empty", () => {
    const diff = diffProblems(session("b", {}), session("a", {}));
    expect(diff).toEqual({ fixed: [], added: [], persisting: [] });
  });
});

describe("summarizeProblemDiff", () => {
  it("celebrates a clean fix", () => {
    const diff = diffProblems(session("b", {}, [problem("a", 50)]), session("a", {}, []));
    const summary = summarizeProblemDiff(diff);
    expect(summary.tone).toBe("good");
    expect(summary.headline).toMatch(/Fixed 1/);
  });

  it("flags a regression when only new problems appear", () => {
    const diff = diffProblems(session("b", {}, []), session("a", {}, [problem("a", 50)]));
    const summary = summarizeProblemDiff(diff);
    expect(summary.tone).toBe("bad");
    expect(summary.headline).toMatch(/Regression/);
  });

  it("notes a mixed fix", () => {
    const diff = diffProblems(
      session("b", {}, [problem("a", 50)]),
      session("a", {}, [problem("z", 50)]),
    );
    expect(summarizeProblemDiff(diff).headline).toMatch(/Mixed/);
  });

  it("summarizes only-persisting sessions", () => {
    const diff = diffProblems(session("b", {}, [problem("a", 50)]), session("a", {}, [problem("a", 20)]));
    const summary = summarizeProblemDiff(diff);
    expect(summary.tone).toBe("neutral");
    expect(summary.headline).toMatch(/cheaper/);
  });

  it("summarizes only-persisting sessions with unchanged impact", () => {
    const diff = diffProblems(session("b", {}, [problem("a", 50)]), session("a", {}, [problem("a", 50)]));
    const summary = summarizeProblemDiff(diff);
    expect(summary.headline).toMatch(/still open/);
  });
});
