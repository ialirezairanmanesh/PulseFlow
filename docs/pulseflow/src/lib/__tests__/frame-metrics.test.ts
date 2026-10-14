import { describe, expect, it } from "vitest";
import { frameDensity, frameSamples, jankRatioOf } from "@/lib/frame-metrics";
import { point } from "./helpers";

describe("frame-metrics", () => {
  it("ignores poll echoes for jank ratio", () => {
    const points = [
      point({ t: 0, frameMs: 18, jank: 1, sample: "frame" }),
      ...Array.from({ length: 20 }, (_, i) =>
        point({ t: 500 * (i + 1), frameMs: 18, jank: 0, sample: "poll" }),
      ),
    ];
    expect(frameSamples(points)).toHaveLength(1);
    expect(jankRatioOf(points)).toBe(1);
    expect(frameDensity(points).sparse).toBe(true);
  });

  it("marks dense scroll-like frame streams", () => {
    const points = Array.from({ length: 120 }, (_, i) =>
      point({
        t: i * 16,
        frameMs: i % 5 === 0 ? 20 : 12,
        jank: i % 5 === 0 ? 1 : 0,
        sample: "frame",
      }),
    );
    const density = frameDensity(points);
    expect(density.dense).toBe(true);
    expect(density.fps).toBeGreaterThan(30);
    expect(jankRatioOf(points)).toBeCloseTo(0.2, 1);
  });

  it("treats legacy points without sample as frames", () => {
    const points = [point({ sample: undefined, jank: 1 }), point({ sample: undefined, jank: 0 })];
    expect(frameSamples(points)).toHaveLength(2);
    expect(jankRatioOf(points)).toBe(0.5);
  });
});