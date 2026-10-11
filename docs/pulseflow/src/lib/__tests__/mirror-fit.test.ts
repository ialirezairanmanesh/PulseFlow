import { describe, expect, it } from "vitest";
import {
  containSize,
  DEFAULT_MIRROR_SIZE,
  formatMirrorSize,
  mirrorAspect,
  MIRROR_SIZE_PRESETS,
  parseMirrorSize,
  presetForSize,
  swapSize,
} from "@/lib/mirror-fit";

describe("mirrorAspect", () => {
  it("is width/height for the chosen size", () => {
    expect(mirrorAspect({ w: 1280, h: 720 })).toBeCloseTo(16 / 9, 5);
    expect(mirrorAspect({ w: 1080, h: 2400 })).toBeCloseTo(0.45, 5);
  });

  it("falls back to 16:9 when the size is invalid", () => {
    expect(mirrorAspect({ w: 0, h: 720 })).toBeCloseTo(16 / 9, 5);
    expect(mirrorAspect({ w: 1280, h: 0 })).toBeCloseTo(16 / 9, 5);
  });
});

describe("presetForSize / swapSize", () => {
  it("matches the repo redroid default preset", () => {
    expect(presetForSize(DEFAULT_MIRROR_SIZE)?.id).toBe("1280x720");
    expect(DEFAULT_MIRROR_SIZE).toEqual({ w: 1280, h: 720 });
  });

  it("returns undefined for a custom size", () => {
    expect(presetForSize({ w: 1234, h: 567 })).toBeUndefined();
  });

  it("swaps width and height", () => {
    expect(swapSize({ w: 1280, h: 720 })).toEqual({ w: 720, h: 1280 });
  });

  it("exposes unique preset ids", () => {
    const ids = MIRROR_SIZE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseMirrorSize / formatMirrorSize", () => {
  it("parses x and × separators", () => {
    expect(parseMirrorSize("1280x720")).toEqual({ w: 1280, h: 720 });
    expect(parseMirrorSize("1080 × 2400")).toEqual({ w: 1080, h: 2400 });
  });

  it("rejects malformed or empty input", () => {
    expect(parseMirrorSize("")).toBeNull();
    expect(parseMirrorSize(null)).toBeNull();
    expect(parseMirrorSize("abc")).toBeNull();
    expect(parseMirrorSize("0x720")).toBeNull();
  });

  it("round-trips through format", () => {
    const size = { w: 720, h: 1280 };
    expect(parseMirrorSize(formatMirrorSize(size))).toEqual(size);
  });
});

describe("containSize", () => {
  it("fills the height when the box is wider than the aspect", () => {
    // pane 1000x500, portrait phone 0.5 -> height-limited: 250x500
    expect(containSize(1000, 500, 0.5)).toEqual({ w: 250, h: 500 });
  });

  it("fills the width when the box is taller than the aspect", () => {
    // pane 400x1000, phone 0.5 -> width-limited: 400x800
    expect(containSize(400, 1000, 0.5)).toEqual({ w: 400, h: 800 });
  });

  it("returns an exact match when the aspect already fits", () => {
    expect(containSize(1280, 720, 16 / 9)).toEqual({ w: 1280, h: 720 });
  });

  it("returns null when there is nothing to measure", () => {
    expect(containSize(0, 500, 0.5)).toBeNull();
    expect(containSize(500, 0, 0.5)).toBeNull();
    expect(containSize(500, 500, 0)).toBeNull();
    expect(containSize(-10, 500, 0.5)).toBeNull();
  });

  it("never exceeds the available area", () => {
    const box = containSize(333, 777, 0.75);
    expect(box).not.toBeNull();
    expect(box!.w).toBeLessThanOrEqual(333);
    expect(box!.h).toBeLessThanOrEqual(777);
    expect(box!.w / box!.h).toBeCloseTo(0.75, 1);
  });
});
