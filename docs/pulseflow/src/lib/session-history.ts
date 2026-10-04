/** A small, serializable snapshot of the headline metrics for a session. */
export interface SessionStats {
  problemCount: number;
  p95BuildMs: number;
  p95RasterMs: number;
  p95FrameMs: number;
  rebuildRate: number;
  heapMb: number;
  jankRatio: number;
}

/** A session persisted to the local history store. */
export interface SavedSession {
  id: string;
  savedAt: number;
  label?: string;
  mode?: string;
  isolateName?: string;
  stats: SessionStats;
  report: unknown;
}

export interface ComparisonRow {
  key: keyof SessionStats;
  label: string;
  before: number;
  after: number;
  delta: number;
  improved: boolean;
}

export const SESSION_STAT_LABELS: ReadonlyArray<[keyof SessionStats, string]> = [
  ["p95BuildMs", "P95 build ms"],
  ["p95RasterMs", "P95 raster ms"],
  ["p95FrameMs", "P95 frame ms"],
  ["rebuildRate", "Rebuild /s"],
  ["heapMb", "Heap MB"],
  ["jankRatio", "Jank ratio"],
  ["problemCount", "Problems"],
];

/** Compares two sessions stat-by-stat (delta = after - before; lower is better). */
export function compareSessions(before: SavedSession, after: SavedSession): ComparisonRow[] {
  return SESSION_STAT_LABELS.map(([key, label]) => {
    const b = before.stats[key];
    const a = after.stats[key];
    const delta = a - b;
    return { key, label, before: b, after: a, delta, improved: delta < 0 };
  });
}

export function formatDelta(key: keyof SessionStats, delta: number): string {
  if (key === "jankRatio") return `${(delta * 100).toFixed(1)} pts`;
  return delta.toFixed(2);
}
