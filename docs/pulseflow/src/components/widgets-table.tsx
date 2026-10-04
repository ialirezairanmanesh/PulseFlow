"use client";

import { useMemo, useState } from "react";
import { tipForWidget } from "@/lib/problems";
import { usePulse } from "@/lib/pulse-store";

export function WidgetsTable() {
  const { hot, hotAvailable, hotMessage, connected, probeFrozen } = usePulse();
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [appOnly, setAppOnly] = useState(true);
  const [duringJankOnly, setDuringJankOnly] = useState(false);

  const routes = useMemo(() => {
    const set = new Set((hot?.widgets ?? []).map((w) => w.route));
    return [...set].sort();
  }, [hot?.widgets]);

  const rows = useMemo(() => {
    let list = hot?.widgets ?? [];
    if (routeFilter !== "all") {
      list = list.filter((w) => w.route === routeFilter);
    }
    if (appOnly) {
      list = list.filter((w) => !w.isFramework);
    }
    if (duringJankOnly) {
      list = list.filter((w) => w.duringJank || hot?.duringJank);
    }
    return list;
  }, [hot?.widgets, hot?.duringJank, routeFilter, appOnly, duringJankOnly]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          Widgets
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Rebuild table with session totals and rolling-window rate
          {hot?.windowMs ? ` (${(hot.windowMs / 1000).toFixed(0)}s window)` : ""}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
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
          {hot?.available && (
            <span className="text-xs text-[var(--ink-faint)]">
              Window {hot.totalRebuildsWindow} · Session {hot.totalRebuildsSession}
              {probeFrozen || hot.frozen ? " · frozen" : ""}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        {!connected ? (
          <p className="flex h-[160px] items-center justify-center text-sm text-[var(--ink-faint)]">
            Widget list appears after Connect
          </p>
        ) : hotAvailable === false ? (
          <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
            {hotMessage ??
              "Widget probe extension not active — add examples/pulseflow_extension.dart to the app"}
          </p>
        ) : rows.length === 0 ? (
          <p className="flex h-[140px] items-center justify-center text-sm text-[var(--ink-faint)]">
            {hotMessage ?? "No rebuilds match these filters — scroll or navigate the UI"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                <tr className="border-b border-white/10">
                  <th className="py-2 font-medium">Widget</th>
                  <th className="py-2 font-medium">Route</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium">Window</th>
                  <th className="py-2 font-medium">Session</th>
                  <th className="py-2 font-medium">Rate/s</th>
                  <th className="py-2 font-medium">Share</th>
                  <th className="py-2 font-medium">Tip</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-white/5 text-[var(--ink-muted)]">
                    <td className="py-2.5">
                      <div className="font-mono text-[13px] text-[var(--ink)]">{w.name}</div>
                      {w.keyLabel && (
                        <div className="text-[11px] text-[var(--ink-faint)]">{w.keyLabel}</div>
                      )}
                      {w.isFramework && (
                        <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
                          framework
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-[12px]">{w.route}</td>
                    <td
                      className="py-2.5 font-mono text-[11px] text-[var(--ink-faint)]"
                      title={w.sourceUri ? `${w.sourceUri}:${w.sourceLine ?? 0}` : undefined}
                    >
                      {w.sourceUri
                        ? `${w.sourceUri.split("/").pop()}${w.sourceLine ? `:${w.sourceLine}` : ""}`
                        : "—"}
                    </td>
                    <td className="py-2.5">{w.rebuildsWindow}</td>
                    <td className="py-2.5">{w.rebuildsSession}</td>
                    <td className="py-2.5">{w.ratePerSec.toFixed(1)}</td>
                    <td className="py-2.5">{w.share.toFixed(1)}%</td>
                    <td className="py-2.5 text-[var(--ink-faint)]">
                      {tipForWidget(w.name, w.share)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
