import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  snapshotFromHash,
  snapshotToHash,
  verdictFromSnapshot,
  baselinesFromSnapshot,
} from "@/lib/session-snapshot";
import type { MetricPoint, HotWidgetsPayload } from "@/lib/types";

function point(p: Partial<MetricPoint> = {}): MetricPoint {
  return {
    t: 1000,
    cpu: 50,
    framePressure: 50,
    frameMs: 14,
    buildMs: 6,
    rasterMs: 8,
    vsyncMs: 0,
    jank: 0,
    heapMb: 120,
    externalMb: 10,
    ...p,
  };
}

describe("session-snapshot round-trip", () => {
  it("encodes and decodes a snapshot via URL hash", () => {
    const snap = buildSnapshot({
      mode: "mock",
      isolateName: "mock-isolate",
      points: [point({ buildMs: 30, rasterMs: 30, frameMs: 60, jank: 1 })],
      hot: null,
      hotAvailable: false,
      gcEvents: [],
      cpuProfile: undefined,
      memoryDiff: undefined,
      network: [],
      scenarioResult: undefined,
      scenarioRunning: null,
      probeFrozen: false,
      baselines: [],
      controlMessage: undefined,
    });

    const hash = snapshotToHash(snap);
    expect(hash).toMatch(/^#s=/);

    const restored = snapshotFromHash(hash);
    expect(restored).not.toBeNull();
    expect(restored!.v).toBe(1);
    expect(restored!.mode).toBe("mock");
    expect(restored!.problems.length).toBeGreaterThan(0); // high_build problem from buildMs 30
  });

  it("returns null for a non-share hash", () => {
    expect(snapshotFromHash("#not-a-snapshot")).toBeNull();
  });

  it("handles garbage base64 gracefully", () => {
    expect(snapshotFromHash("#s=!!!not-base64!!!")).toBeNull();
  });

  it("verdict reflects the snapshot's problems and points", () => {
    const snap = buildSnapshot({
      mode: "mock",
      points: [point({ buildMs: 5, rasterMs: 5, frameMs: 10, jank: 0 })],
      hot: {
        available: true,
        windowMs: 10000,
        totalRebuildsWindow: 100,
        totalRebuildsSession: 100,
        widgets: [
          {
            id: "/|InvoiceList|",
            name: "InvoiceList",
            route: "/",
            rebuildsSession: 50,
            rebuildsWindow: 50,
            ratePerSec: 5,
            share: 50,
            lastSeenMs: 0,
            isFramework: false,
          },
        ],
        screens: [],
      } as HotWidgetsPayload,
      hotAvailable: true,
      gcEvents: [],
      cpuProfile: undefined,
      memoryDiff: undefined,
      network: [],
      scenarioResult: undefined,
      scenarioRunning: null,
      probeFrozen: false,
      baselines: [],
      controlMessage: undefined,
    });

    const verdict = verdictFromSnapshot(snap);
    expect(verdict.status).toBe("good");
    expect(verdict.score).toBeGreaterThan(50);
    expect(snap.problems.length).toBeGreaterThan(0);
  });

  it("baselineFromSnapshot reconstructs a baseline when none provided", () => {
    const snap = buildSnapshot({
      mode: "mock",
      points: [point({ buildMs: 10, rasterMs: 10, frameMs: 16, jank: 0, heapMb: 80 })],
      hot: null,
      hotAvailable: false,
      gcEvents: [],
      cpuProfile: undefined,
      memoryDiff: undefined,
      network: [],
      scenarioResult: undefined,
      scenarioRunning: null,
      probeFrozen: false,
      baselines: [],
      controlMessage: undefined,
    });

    const bl = baselinesFromSnapshot(snap);
    expect(bl.length).toBe(1);
    expect(bl[0].label).toBe("shared");
    expect(bl[0].heapMb).toBe(80);
  });
});
