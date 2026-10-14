import type { MetricPoint } from "@/lib/types";

/** Prefer real Flutter.Frame samples; legacy points without `sample` count as frames. */
export function isFrameSample(p: MetricPoint): boolean {
  return p.sample !== "poll";
}

export function frameSamples(points: MetricPoint[]): MetricPoint[] {
  return points.filter(isFrameSample);
}

/**
 * Dense enough for jank% to be meaningful: ~≥30 fps in the window, or at least
 * 60 real frame events in the last 20s (covers slower captures without poll echo).
 */
export const JANK_DENSE_FPS = 30;
export const JANK_DENSE_MIN_FRAMES = 60;
export const JANK_DENSE_WINDOW_MS = 20_000;

export interface FrameDensity {
  frameCount: number;
  fps: number;
  dense: boolean;
  /** True when jank% would be dominated by repeated stale values / idle gaps. */
  sparse: boolean;
}

export function frameDensity(points: MetricPoint[]): FrameDensity {
  const frames = frameSamples(points);
  const frameCount = frames.length;
  if (frameCount < 2) {
    return { frameCount, fps: 0, dense: false, sparse: true };
  }
  const latestT = frames[frameCount - 1]!.t;
  const windowed = frames.filter((p) => p.t >= latestT - JANK_DENSE_WINDOW_MS);
  const spanMs = windowed[windowed.length - 1]!.t - windowed[0]!.t;
  const fps = spanMs > 0 ? ((windowed.length - 1) / spanMs) * 1000 : 0;
  const dense = fps >= JANK_DENSE_FPS || windowed.length >= JANK_DENSE_MIN_FRAMES;
  return { frameCount: windowed.length, fps, dense, sparse: !dense };
}

export function jankRatioOf(points: MetricPoint[]): number {
  const frames = frameSamples(points);
  if (frames.length === 0) return 0;
  return frames.filter((p) => p.jank).length / frames.length;
}
