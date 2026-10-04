import type {
  BridgeHotWidgetsMessage,
  HotWidgetsPayload,
  ScreenRebuildStat,
  WidgetRebuildStat,
} from "@/lib/types";

/** Normalize legacy or partial hotWidgets messages into HotWidgetsPayload. */
export function normalizeHotWidgetsMessage(
  msg: BridgeHotWidgetsMessage,
): HotWidgetsPayload {
  const windowMs = msg.windowMs || 10000;
  const windowSec = windowMs / 1000;
  const duringJank = Boolean(msg.duringJank);

  const widgets: WidgetRebuildStat[] = (msg.widgets ?? []).map((w) => {
    const anyW = w as WidgetRebuildStat & {
      rebuilds?: number;
      name: string;
      share: number;
      lastSeenMs?: number;
    };
    const name = anyW.name ?? "Widget";
    const route = anyW.route ?? "(unnamed)";
    const keyLabel = anyW.keyLabel;
    const id = anyW.id ?? `${route}|${name}|${keyLabel ?? ""}`;
    const rebuildsWindow = anyW.rebuildsWindow ?? anyW.rebuilds ?? 0;
    const rebuildsSession = anyW.rebuildsSession ?? rebuildsWindow;
    const ratePerSec =
      anyW.ratePerSec ?? Number((rebuildsWindow / windowSec).toFixed(2));
    return {
      id,
      name,
      route,
      keyLabel,
      rebuildsSession,
      rebuildsWindow,
      ratePerSec,
      share: anyW.share ?? 0,
      lastSeenMs: anyW.lastSeenMs ?? 0,
      isFramework: anyW.isFramework,
      duringJank: anyW.duringJank ?? duringJank,
    };
  });

  const totalRebuildsWindow =
    msg.totalRebuildsWindow ??
    msg.totalRebuilds ??
    widgets.reduce((a, w) => a + w.rebuildsWindow, 0);
  const totalRebuildsSession =
    msg.totalRebuildsSession ??
    widgets.reduce((a, w) => a + w.rebuildsSession, 0);

  let screens: ScreenRebuildStat[] = msg.screens ?? [];
  if (!screens.length && widgets.length) {
    const byRoute = new Map<string, WidgetRebuildStat[]>();
    for (const w of widgets) {
      const list = byRoute.get(w.route) ?? [];
      list.push(w);
      byRoute.set(w.route, list);
    }
    screens = [...byRoute.entries()]
      .map(([route, list]) => {
        const rebuildsWindow = list.reduce((a, x) => a + x.rebuildsWindow, 0);
        return {
          route,
          rebuildsWindow,
          ratePerSec: Number((rebuildsWindow / windowSec).toFixed(2)),
          share:
            totalRebuildsWindow > 0
              ? Number(((rebuildsWindow / totalRebuildsWindow) * 100).toFixed(1))
              : 0,
          topWidgets: list.slice(0, 5),
        };
      })
      .sort((a, b) => b.rebuildsWindow - a.rebuildsWindow);
  }

  return {
    available: msg.available,
    windowMs,
    totalRebuildsWindow,
    totalRebuildsSession,
    widgets,
    screens,
    problems: msg.problems,
    frozen: msg.frozen,
    duringJank,
    message: msg.message,
  };
}
