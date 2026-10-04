import type { HotWidgetsPayload, MetricPoint, WidgetRebuildStat } from "@/lib/types";

export function widget(overrides: Partial<WidgetRebuildStat> = {}): WidgetRebuildStat {
  return {
    id: "route|Widget|",
    name: "Widget",
    route: "/route",
    rebuildsSession: 0,
    rebuildsWindow: 0,
    ratePerSec: 0,
    share: 0,
    lastSeenMs: 0,
    ...overrides,
  };
}

export function hotPayload(
  widgets: WidgetRebuildStat[],
  extra: Partial<HotWidgetsPayload> = {},
): HotWidgetsPayload {
  return {
    available: true,
    windowMs: 10000,
    totalRebuildsWindow: widgets.reduce((sum, w) => sum + w.rebuildsWindow, 0),
    totalRebuildsSession: widgets.reduce((sum, w) => sum + w.rebuildsSession, 0),
    widgets,
    screens: [],
    ...extra,
  };
}

export function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    t: 0,
    cpu: 0,
    framePressure: 0,
    frameMs: 0,
    buildMs: 0,
    rasterMs: 0,
    vsyncMs: 0,
    jank: 0,
    heapMb: 0,
    externalMb: 0,
    ...overrides,
  };
}
