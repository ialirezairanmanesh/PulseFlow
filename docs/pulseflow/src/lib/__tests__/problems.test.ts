import { describe, expect, it } from "vitest";
import { buildProblems, computeBaselineMetrics, tipForWidget } from "@/lib/problems";
import type { NetworkRequest } from "@/lib/types";
import { hotPayload, point, widget } from "./helpers";

function slow(uri: string, latencyMs: number): NetworkRequest {
  return {
    id: uri,
    t: 0,
    method: "GET",
    uri,
    latencyMs,
    requestBytes: 0,
    responseBytes: 0,
    status: 200,
  };
}

describe("buildProblems", () => {
  it("flags heavy app rebuilds as high severity", () => {
    const problems = buildProblems({
      hot: hotPayload([widget({ name: "InvoiceCard", ratePerSec: 22, share: 40 })]),
      hotAvailable: true,
      gcEvents: [],
    });
    expect(problems[0].kind).toBe("hot_rebuild");
    expect(problems[0].severity).toBe("high");
    expect(problems[0].widget).toBe("InvoiceCard");
  });

  it("ignores framework widgets and quiet rebuilds", () => {
    const problems = buildProblems({
      hot: hotPayload([
        widget({ name: "Padding", isFramework: true, ratePerSec: 40, share: 60 }),
        widget({ name: "Small", ratePerSec: 2, share: 5 }),
      ]),
      hotAvailable: true,
      gcEvents: [],
    });
    expect(problems.some((p) => p.kind === "hot_rebuild")).toBe(false);
  });

  it("uses the measured frame budget for build/raster problems", () => {
    const under60hz = buildProblems({
      hot: null,
      hotAvailable: true,
      latest: point({ buildMs: 6, rasterMs: 0 }),
      gcEvents: [],
    });
    expect(under60hz.some((p) => p.kind === "high_build")).toBe(false);

    const under120hz = buildProblems({
      hot: null,
      hotAvailable: true,
      latest: point({ buildMs: 6, buildBudgetMs: 8.33 }),
      gcEvents: [],
    });
    expect(under120hz.some((p) => p.kind === "high_build")).toBe(true);
  });

  it("reports a missing widget probe", () => {
    const problems = buildProblems({ hot: null, hotAvailable: false, gcEvents: [] });
    expect(problems.some((p) => p.kind === "missing_probe")).toBe(true);
  });

  it("ranks high severity before medium", () => {
    const problems = buildProblems({
      hot: hotPayload([widget({ name: "Card", ratePerSec: 9, share: 22 })]),
      hotAvailable: true,
      latest: point({ buildMs: 14 }),
      gcEvents: [],
    });
    const severities = problems.map((p) => p.severity);
    const firstMedium = severities.indexOf("medium");
    const lastHigh = severities.lastIndexOf("high");
    if (firstMedium !== -1 && lastHigh !== -1) {
      expect(lastHigh).toBeLessThan(firstMedium);
    }
  });

  it("includes slow HTTP with method, uri, and severity", () => {
    const problems = buildProblems({
      hot: null,
      hotAvailable: true,
      network: [slow("/api/slow", 2000), slow("/api/ok", 20)],
      gcEvents: [],
    });
    const http = problems.find((p) => p.kind === "slow_http");
    expect(http?.title).toContain("/api/slow");
    expect(http?.severity).toBe("high");
    expect(problems.some((p) => p.id.includes("/api/ok"))).toBe(false);
  });

  it("attaches widget source locations", () => {
    const problems = buildProblems({
      hot: hotPayload([
        widget({
          name: "Card",
          ratePerSec: 20,
          share: 40,
          sourceUri: "package:app/lib/card.dart",
          sourceLine: 42,
        }),
      ]),
      hotAvailable: true,
      gcEvents: [],
    });
    const hot = problems.find((p) => p.kind === "hot_rebuild");
    expect(hot?.sourceUri).toBe("package:app/lib/card.dart");
    expect(hot?.sourceLine).toBe(42);
    expect(hot?.detail).toContain(":42");
  });

  it("caps the list at eight problems", () => {
    const widgets = Array.from({ length: 12 }, (_, i) =>
      widget({ id: `w${i}`, name: `W${i}`, ratePerSec: 20, share: 40 }),
    );
    const problems = buildProblems({
      hot: hotPayload(widgets),
      hotAvailable: true,
      gcEvents: [],
    });
    expect(problems.length).toBeLessThanOrEqual(8);
  });

  it("ranks overflow and exception errors", () => {
    const problems = buildProblems({
      hot: null,
      hotAvailable: true,
      gcEvents: [],
      errors: [
        { kind: "overflow", signature: "RenderFlex overflowed by 24px", count: 3, route: "/invoices", top: [] },
        { kind: "exception", signature: "Bad state: no element", count: 1, top: [] },
      ],
    });
    const overflow = problems.find((p) => p.kind === "error_overflow");
    expect(overflow?.severity).toBe("high");
    expect(overflow?.route).toBe("/invoices");
    expect(problems.some((p) => p.kind === "error_exception")).toBe(true);
  });
});

describe("computeBaselineMetrics", () => {
  it("propagates problemCount and computes P95/jank ratio", () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      point({ buildMs: i + 1, rasterMs: i, frameMs: 20, jank: i < 5 ? 1 : 0 }),
    );
    const baseline = computeBaselineMetrics({
      points,
      hot: null,
      problemCount: 3,
      label: "before",
    });
    expect(baseline.problemCount).toBe(3);
    expect(baseline.p95BuildMs).toBe(10);
    expect(baseline.jankRatio).toBeCloseTo(0.5, 5);
  });
});

describe("tipForWidget", () => {
  it("suggests virtualization for lists", () => {
    expect(tipForWidget("ListView", 10)).toMatch(/virtuali/i);
  });
});
