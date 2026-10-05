import type {
  BridgeHotWidgetsMessage,
  HotWidgetsPayload,
  ScreenRebuildStat,
  WidgetRebuildStat,
} from "@/lib/types";
import { isFrameworkWidgetName } from "@/lib/framework-widget";

/** Normalize legacy or partial hotWidgets messages into HotWidgetsPayload. */
export function normalizeHotWidgetsMessage(
  msg: BridgeHotWidgetsMessage,
): HotWidgetsPayload {
  const windowMs = msg.windowMs || 10000;
  const windowSec = windowMs / 1000;
  const duringJank = Boolean(msg.duringJank);

  const totalRebuildsWindowHint =
    msg.totalRebuildsWindow ??
    msg.totalRebuilds ??
    (msg.widgets ?? []).reduce((a, w) => a + (w.rebuildsWindow ?? 0), 0);

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
    const computedShare =
      totalRebuildsWindowHint > 0
        ? Number(((rebuildsWindow / totalRebuildsWindowHint) * 100).toFixed(1))
        : 0;
    // Prefer a positive computed share when the wire value is missing/zero.
    const share =
      anyW.share != null && anyW.share > 0 ? anyW.share : computedShare;
    return {
      id,
      name,
      route,
      keyLabel,
      rebuildsSession,
      rebuildsWindow,
      ratePerSec,
      share,
      lastSeenMs: anyW.lastSeenMs ?? 0,
      isFramework: Boolean(anyW.isFramework) || isFrameworkWidgetName(name),
      duringJank: anyW.duringJank ?? duringJank,
      sourceUri: anyW.sourceUri,
      sourceLine: anyW.sourceLine,
      cause: anyW.cause,
    };
  });

  const totalRebuildsWindow =
    totalRebuildsWindowHint || widgets.reduce((a, w) => a + w.rebuildsWindow, 0);
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
    currentRoute: msg.currentRoute,
    widgets,
    screens,
    problems: msg.problems,
    frozen: msg.frozen,
    duringJank,
    message: msg.message,
  };
}
