import { describe, expect, it } from "vitest";
import type { SavedSession, SessionStats } from "@/lib/session-history";
import { compareSessions, formatDelta } from "@/lib/session-history";

function session(id: string, stats: Partial<SessionStats>): SavedSession {
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
