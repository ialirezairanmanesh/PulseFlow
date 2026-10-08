"use client";

import { useEffect, useMemo, useState } from "react";
import { toEditorUrl } from "@/lib/editor-link";
import { buildProblems, tipForWidget } from "@/lib/problems";
import { usePulse } from "@/lib/pulse-store";
import type { WidgetRebuildStat } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  heatBadgeClass,
  heatRowClass,
  widgetHeat,
} from "@/lib/widget-heat";

export function WidgetsTable() {
  const {
    hot,
    hotAvailable,
    hotMessage,
    connected,
    probeFrozen,
    rebuildCauses,
    points,
    gcEvents,
    cpuProfile,
    memoryDiff,
    network,
    scenarioResult,
    scenarioRunning,
    appErrors,
    stalls,
  } = usePulse();

  const currentRoute = hot?.currentRoute;
  const [followCurrent, setFollowCurrent] = useState(true);
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [appOnly, setAppOnly] = useState(true);
  const [duringJankOnly, setDuringJankOnly] = useState(false);
  /** Last non-empty mounted tree per route — survives brief empty polls. */
  const [treeByRoute, setTreeByRoute] = useState<Record<string, WidgetRebuildStat[]>>(
    {},
  );

  useEffect(() => {
    if (followCurrent && currentRoute) {
      setRouteFilter(currentRoute);
    }
  }, [followCurrent, currentRoute]);

  // Cache the mounted tree so widgets don't flash in/out between polls.
  useEffect(() => {
    const incoming = hot?.tree?.length
      ? hot.tree
      : (hot?.widgets ?? []).some((w) => w.inTree || w.depth != null)
        ? (hot?.widgets ?? [])
        : [];
    if (!incoming.length) return;

    const byRoute = new Map<string, WidgetRebuildStat[]>();
    for (const w of incoming) {
      const list = byRoute.get(w.route) ?? [];
      list.push(w);
      byRoute.set(w.route, list);
    }
    if (!byRoute.size) return;

    setTreeByRoute((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [route, list] of byRoute) {
        const prevList = prev[route];
        if (
          !prevList ||
          prevList.length !== list.length ||
          prevList.some((p, i) => p.id !== list[i]?.id || p.rebuildsWindow !== list[i]?.rebuildsWindow)
        ) {
          next[route] = list;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [hot?.tree, hot?.widgets]);

  const causeByWidget = useMemo(
    () => new Map((rebuildCauses?.attributed ?? []).map((a) => [a.widget, a.root])),
    [rebuildCauses],
  );

  const problems = useMemo(
    () =>
      buildProblems({
        hot,
        hotAvailable,
        latest: points.at(-1),
        gcEvents,
        cpuProfile,
        memoryDiff,
        network,
        points,
        scenarioResult,
        scenarioRunning,
        rebuildCauses,
        errors: appErrors,
        stalls,
      }),
    [
      hot,
      hotAvailable,
      points,
      gcEvents,
      cpuProfile,
      memoryDiff,
      network,
      scenarioResult,
      scenarioRunning,
      rebuildCauses,
      appErrors,
      stalls,
    ],
  );

  const activeRoute = followCurrent && currentRoute ? currentRoute : routeFilter;

  const routes = useMemo(() => {
    const set = new Set([
      ...Object.keys(treeByRoute),
      ...(hot?.widgets ?? []).map((w) => w.route),
    ]);
    if (currentRoute) set.add(currentRoute);
    return [...set].sort();
  }, [treeByRoute, hot?.widgets, currentRoute]);

  const rows = useMemo(() => {
    const hasTree = activeRoute !== "all" && (treeByRoute[activeRoute]?.length ?? 0) > 0;
    let list: WidgetRebuildStat[] = hasTree
      ? treeByRoute[activeRoute]!
      : activeRoute === "all"
        ? Object.values(treeByRoute).flat()
        : (hot?.widgets ?? []).filter((w) => w.route === activeRoute);

    if (!list.length) {
      list = (hot?.widgets ?? []).filter(
        (w) => activeRoute === "all" || w.route === activeRoute,
      );
    }

    if (appOnly) {
      list = list.filter((w) => !w.isFramework);
    }
    if (duringJankOnly) {
      list = list.filter((w) => w.duringJank || hot?.duringJank);
    }

    // After appOnly filtering, keep relative indent from the shallowest visible node.
    const depths = list.map((w) => w.depth ?? 0);
    const minDepth = depths.length ? Math.min(...depths) : 0;

    // Keep probe preorder when we have a tree; only heat-sort flat rebuild lists.
    const enriched = list.map((w) => ({
      w,
      heat: widgetHeat(w, problems),
      cause: causeByWidget.get(w.name) ?? w.cause,
      visualDepth: Math.max(0, (w.depth ?? 0) - minDepth),
    }));

    const isTreeOrder = list.some((w) => w.depth != null || w.inTree);
    if (!isTreeOrder) {
      enriched.sort((a, b) => {
        if (b.heat.score !== a.heat.score) return b.heat.score - a.heat.score;
        return a.w.name.localeCompare(b.w.name);
      });
    }
    return enriched;
  }, [
    treeByRoute,
    activeRoute,
    hot?.widgets,
    hot?.duringJank,
    appOnly,
    duringJankOnly,
    problems,
    causeByWidget,
  ]);

  const problemWidgetCount = rows.filter((r) => r.heat.count > 0).length;
  const screenLabel =
    followCurrent && currentRoute
      ? currentRoute
      : routeFilter === "all"
        ? "All screens"
        : routeFilter;
  const showingTree = rows.some((r) => r.w.depth != null || r.w.inTree);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          Widgets
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {showingTree
            ? "Mounted widget tree for this screen — stays while the page is open; hotter rows mean more problems"
            : "Rebuilds on the current screen — hotter rows mean more problems and rebuild pressure"}
          {hot?.windowMs ? ` · ${(hot.windowMs / 1000).toFixed(0)}s window` : ""}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-[var(--ink)]">
            {screenLabel}
          </span>
          {showingTree && (
            <span className="rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2.5 py-1 text-[var(--accent)]">
              {rows.length} in tree
            </span>
          )}
          {problemWidgetCount > 0 && (
            <span className="rounded-md border border-rose-400/35 bg-rose-500/15 px-2.5 py-1 text-rose-100">
              {problemWidgetCount} widget{problemWidgetCount === 1 ? "" : "s"} with problems
            </span>
          )}
          {hot?.available && (
            <span className="text-[var(--ink-faint)]">
              Window {hot.totalRebuildsWindow} · Session {hot.totalRebuildsSession}
              {probeFrozen || hot.frozen ? " · frozen" : ""}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={followCurrent}
              onChange={(e) => setFollowCurrent(e.target.checked)}
            />
            This screen
          </label>
          {!followCurrent && (
            <label className="flex items-center gap-2 text-[var(--ink-muted)]">
              Route
              <select
                className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[var(--ink)]"
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
              >
                <option value="all">All</option>
                {routes.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={appOnly}
              onChange={(e) => setAppOnly(e.target.checked)}
            />
            App widgets only
          </label>
          <label className="flex items-center gap-2 text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={duringJankOnly}
              onChange={(e) => setDuringJankOnly(e.target.checked)}
            />
            During jank
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        {!connected ? (
          <p className="flex h-[160px] items-center justify-center text-sm text-[var(--ink-faint)]">
            Widget tree appears after Connect
          </p>
        ) : hotAvailable === false ? (
          <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
            {hotMessage ??
              "Widget probe not active — add package:pulseflow_flutter and call registerPulseFlow()"}
          </p>
        ) : rows.length === 0 ? (
          <p className="flex h-[140px] items-center justify-center text-sm text-[var(--ink-faint)]">
            {followCurrent && currentRoute
              ? `Waiting for widget tree on ${currentRoute} — open this screen in the app (and hot-restart if you just updated the extension)`
              : (hotMessage ?? "No widgets match these filters")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                <tr className="border-b border-white/10">
                  <th className="py-2 font-medium">Widget</th>
                  <th className="py-2 font-medium">Problems</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium">Cause</th>
                  <th className="py-2 font-medium">Window</th>
                  <th className="py-2 font-medium">Session</th>
                  <th className="py-2 font-medium">Rate/s</th>
                  <th className="py-2 font-medium">Share</th>
                  <th className="py-2 font-medium">Tip</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ w, heat, cause, visualDepth }) => {
                  const depth = visualDepth;
                  return (
                    <tr
                      key={w.id}
                      className={cn(
                        "border-b border-white/5 text-[var(--ink-muted)] transition-colors duration-300",
                        heatRowClass(heat),
                      )}
                    >
                      <td className="py-2.5 pl-2">
                        <div
                          className="font-mono text-[13px] text-[var(--ink)]"
                          style={{ paddingInlineStart: `${Math.min(depth, 12) * 12}px` }}
                        >
                          {showingTree && depth > 0 && (
                            <span className="mr-1 text-[var(--ink-faint)]">└</span>
                          )}
                          {w.name}
                        </div>
                        {w.keyLabel && (
                          <div
                            className="text-[11px] text-[var(--ink-faint)]"
                            style={{ paddingInlineStart: `${Math.min(depth, 12) * 12}px` }}
                          >
                            {w.keyLabel}
                          </div>
                        )}
                        {w.isFramework && (
                          <div
                            className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]"
                            style={{ paddingInlineStart: `${Math.min(depth, 12) * 12}px` }}
                          >
                            framework
                          </div>
                        )}
                        {w.duringJank && (
                          <div
                            className="text-[10px] uppercase tracking-wider text-rose-200/80"
                            style={{ paddingInlineStart: `${Math.min(depth, 12) * 12}px` }}
                          >
                            during jank
                          </div>
                        )}
                      </td>
                      <td className="py-2.5">
                        {heat.count > 0 ? (
                          <div className="space-y-1">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                                heatBadgeClass(heat),
                              )}
                              title={heat.problems.map((p) => p.title).join(" · ")}
                            >
                              {heat.count} problem{heat.count === 1 ? "" : "s"}
                            </span>
                            <div className="max-w-[200px] truncate text-[10px] text-rose-100/70">
                              {heat.problems[0]?.title}
                            </div>
                          </div>
                        ) : heat.maxSeverity ? (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px]",
                              heatBadgeClass(heat),
                            )}
                          >
                            pressure
                          </span>
                        ) : (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-[var(--ink-faint)]">
                        {w.sourceUri ? (
                          toEditorUrl(w.sourceUri, w.sourceLine) ? (
                            <a
                              className="underline decoration-dotted hover:text-[var(--accent)]"
                              href={toEditorUrl(w.sourceUri, w.sourceLine)!}
                              title={`${w.sourceUri}:${w.sourceLine ?? 0}`}
                            >
                              {`${w.sourceUri.split("/").pop()}${w.sourceLine ? `:${w.sourceLine}` : ""}`}
                            </a>
                          ) : (
                            <span title={`${w.sourceUri}:${w.sourceLine ?? 0}`}>
                              {`${w.sourceUri.split("/").pop()}${w.sourceLine ? `:${w.sourceLine}` : ""}`}
                            </span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 text-[11px] text-[var(--ink-faint)]">{cause ?? "—"}</td>
                      <td className="py-2.5 tabular-nums">{w.rebuildsWindow}</td>
                      <td className="py-2.5 tabular-nums">{w.rebuildsSession}</td>
                      <td className="py-2.5 tabular-nums">{w.ratePerSec.toFixed(1)}</td>
                      <td className="py-2.5 tabular-nums">{w.share.toFixed(1)}%</td>
                      <td className="py-2.5 text-[var(--ink-faint)]">
                        {tipForWidget(w.name, w.share, {
                          ratePerSec: w.ratePerSec,
                          duringJank: w.duringJank,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
