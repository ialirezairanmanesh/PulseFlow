import { describe, expect, it } from "vitest";
import { healthFromPoint, normalizePoint, statusVariant } from "@/lib/chart-utils";
import { point } from "./helpers";

describe("statusVariant", () => {
  it("maps connection status and mode", () => {
    expect(statusVariant("connected")).toBe("live");
    expect(statusVariant("connected", "mock")).toBe("mock");
    expect(statusVariant("error")).toBe("error");
    expect(statusVariant("idle")).toBe("idle");
  });
});

describe("normalizePoint", () => {
  it("prefers framePressure and falls back to legacy cpu", () => {
    const legacy = { ...point(), framePressure: undefined as unknown as number, cpu: 12 };
    expect(normalizePoint(legacy).framePressure).toBe(12);
    expect(normalizePoint(point({ cpu: 99, framePressure: 55 })).framePressure).toBe(55);
  });
});

describe("healthFromPoint", () => {
  it("reports no data without a point", () => {
    expect(healthFromPoint(undefined).label).toBe("No data");
  });

  it("flags very heavy frames", () => {
    expect(healthFromPoint(point({ frameMs: 30, buildMs: 20, rasterMs: 10 })).tone).toBe("bad");
  });

  it("reports smooth frames under budget", () => {
    expect(healthFromPoint(point({ frameMs: 8, buildMs: 4, rasterMs: 3 })).tone).toBe("good");
  });
});
