"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Snowflake, CircleDot, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FixPlan } from "@/components/fix-plan";
import { HealthVerdict } from "@/components/health-verdict";
import { buildProblems } from "@/lib/problems";
import { computeVerdict } from "@/lib/verdict";
import { usePulse } from "@/lib/pulse-store";
import { baselinesFromSnapshot, verdictFromSnapshot } from "@/lib/session-snapshot";

export function ProblemsList() {
  const {
    hot,
    hotAvailable,
    hotMessage,
    points,
    gcEvents,
    connected,
    error,
    probeFrozen,
    isRecording,
    problemsSnapshot,
    controlMessage,
    hotWidgetsControl,
    cpuProfile,
    memoryDiff,
    network,
    scenarioResult,
    scenarioRunning,
    rebuildCauses,
    appErrors,
    buildInfo,
    stalls,
    sharedView,
    clearShared,
  } = usePulse();

  // When a shared link is opened without a live connection, render the
  // pre-computed snapshot read-only (no Record/Freeze controls).
  const isSharedView = Boolean(sharedView) && !connected;

  const [focusRoute, setFocusRoute] = useState("");
  const [warmupSec, setWarmupSec] = useState(0);

  // Route focus + cold-start (warmup) filter, applied to every problem source.
  const liveStalls = probeFrozen && problemsSnapshot ? problemsSnapshot.stalls : stalls;
  const routes = useMemo(() => {
    const set = new Set<string>();
    for (const s of hot?.screens ?? []) if (s.route && s.route !== "(unnamed)") set.add(s.route);
    if (hot?.currentRoute) set.add(hot.currentRoute);
    for (const s of liveStalls?.stalls ?? []) if (s.route) set.add(s.route);
    for (const e of appErrors) if (e.route) set.add(e.route);
    return [...set].sort();
  }, [hot, liveStalls, appErrors]);

  const warmupCutoff = warmupSec > 0 && points.length > 0 ? points[0].t + warmupSec * 1000 : 0;
  const activePoints = warmupCutoff ? points.filter((p) => p.t >= warmupCutoff) : points;

  const routeMatch = (route?: string) => !focusRoute || !route || route === focusRoute;
  const focusHot =
    focusRoute && hot
      ? {
          ...hot,
          widgets: hot.widgets.filter((w) => routeMatch(w.route)),
          tree: hot.tree?.filter((w) => routeMatch(w.route)),
          screens: hot.screens.filter((s) => routeMatch(s.route)),
        }
      : hot;
  const focusStalls =
    focusRoute && liveStalls
      ? { ...liveStalls, stalls: liveStalls.stalls.filter((s) => routeMatch(s.route)) }
      : liveStalls;
  const focusErrors = focusRoute ? appErrors.filter((e) => routeMatch(e.route)) : appErrors;
  const focusCauses =
    focusRoute && rebuildCauses
      ? { ...rebuildCauses, roots: rebuildCauses.roots.filter((r) => routeMatch(r.route)) }
      : rebuildCauses;

  const input = isSharedView
    ? {
        hot: sharedView!.hot,
        hotAvailable: sharedView!.hot?.available ?? null,
        latest: sharedView!.points.at(-1),
        gcEvents: [],
        cpuProfile: undefined,
        memoryDiff: undefined,
        network: [],
        scenarioResult: undefined,
        scenarioRunning: null,
      }
    : probeFrozen && problemsSnapshot
      ? problemsSnapshot
      : {
          hot: focusHot,
          hotAvailable,
          latest: activePoints.at(-1),
          gcEvents,
          cpuProfile,
          memoryDiff,
          network,
          scenarioResult,
          scenarioRunning,
        };

  // During Record quiet window, force an empty problem list so the reset is visible
  const problems = isSharedView
    ? sharedView!.problems
    : isRecording
      ? []
      : buildProblems({
          hot: input.hot,
          hotAvailable: input.hotAvailable,
          latest: input.latest,
          gcEvents: input.gcEvents,
          cpuProfile: input.cpuProfile,
          memoryDiff: input.memoryDiff,
          network: input.network ?? network,
          points: sharedView ? [] : activePoints,
          scenarioResult: input.scenarioResult,
          scenarioRunning: input.scenarioRunning,
          rebuildCauses: focusCauses,
          errors: focusErrors,
          stalls: probeFrozen && problemsSnapshot ? problemsSnapshot.stalls : focusStalls,
        });

  const verdict = isSharedView
    ? verdictFromSnapshot(sharedView!)
    : isRecording
      ? null
      : computeVerdict({
          points: activePoints,
          problems,
          budgetMs: input.latest?.buildBudgetMs,
        });

  const sharedBaselines = isSharedView
    ? baselinesFromSnapshot(sharedView!)
    : [];

  const hasDetails =
    (input.hot?.screens?.length ?? 0) > 0 ||
    (focusCauses?.roots.length ?? 0) > 0 ||
    focusErrors.length > 0;

  return (
    <div className="space-y-4">
      {verdict && <HealthVerdict verdict={verdict} />}
      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Problems
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Ranked issues to fix first — screen, widget, rate, and a concrete tip
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={isRecording ? "default" : "secondary"}
            disabled={!connected || isRecording || isSharedView}
            title="Clear session counters and start a clean measurement"
            onClick={() => hotWidgetsControl("reset")}
          >
            <CircleDot className="h-3.5 w-3.5" />
            {isRecording ? "Recording…" : "Record"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={probeFrozen ? "default" : "outline"}
            disabled={!connected || isSharedView}
            title={
              probeFrozen
                ? "Resume live rebuild sampling"
                : "Hold rankings still while you inspect"
            }
            onClick={() => hotWidgetsControl(probeFrozen ? "unfreeze" : "freeze")}
          >
            <Snowflake className="h-3.5 w-3.5" />
            {probeFrozen ? "Unfreeze" : "Freeze"}
          </Button>
          {sharedView ? (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={clearShared}
              title="Connect to a live app to inspect the real session"
            >
              Connect live
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link href="/report">
                <FileDown className="h-3.5 w-3.5" />
                Report
              </Link>
            </Button>
          )}
        </div>
      </section>

      {isSharedView && (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <span className="font-medium">Read-only shared view.</span> The rankings above were
          captured at link time — Record/Freeze are disabled until you connect a live app.
          {sharedBaselines.length > 0 &&
            ` · ${sharedBaselines.length} baseline${sharedBaselines.length > 1 ? "s" : ""} restored`}
        </p>
      )}

      {connected && !isSharedView && (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm backdrop-blur-sm">
          <span className="text-[var(--ink-faint)]">Focus</span>
          <select
            aria-label="Focus route"
            value={focusRoute}
            onChange={(e) => setFocusRoute(e.target.value)}
            className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="text-[var(--ink-faint)]">· exclude first</span>
          <select
            aria-label="Exclude cold start"
            value={warmupSec}
            onChange={(e) => setWarmupSec(Number(e.target.value))}
            className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            {[0, 2, 5, 10, 20].map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "off" : `${s}s`}
              </option>
            ))}
          </select>
          {(focusRoute || warmupSec > 0) && (
            <span className="text-xs text-[var(--ink-faint)]">
              {focusRoute ? `route ${focusRoute}` : "all routes"}
              {warmupSec > 0
                ? ` · dropped ${points.length - activePoints.length} early samples`
                : ""}
            </span>
          )}
        </section>
      )}

      {(controlMessage || error) && (
        <p
          className={
            error
              ? "rounded-md border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
              : "rounded-md border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-sm text-teal-100"
          }
        >
          {error ?? controlMessage}
        </p>
      )}

      {hotAvailable === false && (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
          {hotMessage ??
            "Widget probe not active — add package:pulseflow_flutter and call registerPulseFlow()"}
        </p>
      )}

      {buildInfo && buildInfo.probes.rebuildProbe === false && (
        <p className="rounded-md border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
          {buildInfo.buildMode} build: widget rebuild causes and source locations need a{" "}
          <span className="text-sky-50">Debug</span> build (Flutter&apos;s rebuild hook is
          assert-only). Frame timing, CPU, errors, and image data are still captured.
        </p>
      )}

      {probeFrozen && (
        <p className="text-sm text-[var(--ink-faint)]">
          Frozen — problem ranks and widget samples are held. Click Unfreeze to resume.
        </p>
      )}

      {problems.length === 0 ? (
        <div className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-4 py-6 text-sm text-teal-100">
          {isRecording
            ? "Recording — session cleared. Interact with the app; new problems will appear here."
            : hotMessage ??
              "Looking good — scroll or navigate the app to surface hidden rebuild pressure."}
        </div>
      ) : (
        <FixPlan problems={problems} budgetMs={input.latest?.buildBudgetMs ?? 16.67} />
      )}

      {!isRecording && hasDetails && (
        <details className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-sm">
          <summary className="cursor-pointer select-none text-sm text-[var(--ink-muted)]">
            Show details — screens, rebuild roots, errors
          </summary>
          <div className="mt-3 space-y-3">
            {input.hot?.screens && input.hot.screens.length > 0 && (
              <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
                <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
                  Screens (window)
                </h3>
                <p className="mb-3 text-sm text-[var(--ink-muted)]">
                  Rebuild pressure by route in the last{" "}
                  {((input.hot.windowMs || 10000) / 1000).toFixed(0)}s
                </p>
                <div className="space-y-2">
                  {input.hot.screens.slice(0, 6).map((s) => (
                    <div
                      key={s.route}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-[var(--ink)]">{s.route}</span>
                      <span className="text-[var(--ink-muted)]">
                        {s.ratePerSec.toFixed(1)}/s · {s.share.toFixed(1)}% ·{" "}
                        {s.rebuildsWindow} rebuilds
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {rebuildCauses && rebuildCauses.roots.length > 0 && (
              <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
                <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
                  Rebuild roots
                </h3>
                <p className="mb-3 text-sm text-[var(--ink-muted)]">
                  Widgets that rebuilt without a rebuilt ancestor — the likely trigger for the
                  rebuilds
                </p>
                <div className="space-y-2">
                  {rebuildCauses.roots.slice(0, 6).map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/8 bg-white/5 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-[var(--ink)]">{r.widget}</span>
                      <span className="text-[var(--ink-muted)]">
                        {r.ratePerSec.toFixed(1)}/s · {r.rebuilds} rebuilds · {r.children} children ·{" "}
                        {r.route}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {appErrors.length > 0 && (
              <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
                <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
                  Errors
                </h3>
                <p className="mb-3 text-sm text-[var(--ink-muted)]">
                  Overflow, assertions, and exceptions captured at runtime
                </p>
                <ul className="space-y-2 text-sm">
                  {appErrors.slice(0, 8).map((e) => (
                    <li
                      key={`${e.kind}-${e.signature}`}
                      className="rounded-md border border-white/8 bg-white/5 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[var(--ink)]">{e.signature}</span>
                        <span className="text-[var(--ink-muted)]">
                          {e.count}× · {e.kind}
                          {e.route ? ` · ${e.route}` : ""}
                        </span>
                      </div>
                      {e.top.length > 0 && (
                        <div className="mt-1 font-mono text-[11px] text-[var(--ink-faint)]">
                          {e.top[0]}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
