"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";
import { usePulse } from "@/lib/pulse-store";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/6 py-2 last:border-0">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="font-mono text-sm text-[var(--ink)]">{value}</span>
    </div>
  );
}

function fmtExtra(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function DevicePanel() {
  const { deviceContext, stalls, capabilities, connected, mode } = usePulse();
  const capMissing = capabilities?.deviceContext === false;
  const unavailable =
    !deviceContext || deviceContext.available === false || capMissing;
  const display = deviceContext?.display;
  const extras = deviceContext?.extras
    ? Object.entries(deviceContext.extras).filter(([, v]) => v != null)
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          Device
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Platform, display budget, and locale from{" "}
          <code className="font-mono text-xs">ext.pulseflow.getDeviceContext</code>
        </p>
      </div>

      {unavailable ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
          <Smartphone className="mx-auto mb-2 h-5 w-5 text-[var(--ink-faint)]" />
          {capMissing || deviceContext?.available === false ? (
            <>
              Device context RPC is not available. Add{" "}
              <code className="font-mono text-xs">pulseflow_flutter</code> ≥ 0.2, call{" "}
              <code className="font-mono text-xs">registerPulseFlow()</code>, hot-restart, then
              Connect again.
            </>
          ) : connected ? (
            "Waiting for device context…"
          ) : (
            "Connect a device (or demo mode) to load context."
          )}
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              App
            </h3>
            <p className="mb-2 text-sm text-[var(--ink-muted)]">
              Runtime identity for this isolate
              {mode === "mock" ? " · demo sample" : ""}
            </p>
            <Row label="Platform" value={deviceContext.platform ?? "—"} />
            <Row label="Build mode" value={deviceContext.buildMode ?? "—"} />
            <Row label="Locale" value={deviceContext.locale ?? "—"} />
            <Row
              label="Text scale"
              value={
                deviceContext.textScale != null
                  ? deviceContext.textScale.toFixed(2)
                  : "—"
              }
            />
            <Row label="App package" value={deviceContext.appPackage ?? "—"} />
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Display
            </h3>
            <p className="mb-2 text-sm text-[var(--ink-muted)]">
              Refresh rate drives the frame budget used on Problems and Frames
            </p>
            <Row
              label="Refresh rate"
              value={
                display?.refreshRate != null ? `${display.refreshRate} Hz` : "—"
              }
            />
            <Row
              label="Frame budget"
              value={
                display?.budgetMs != null ? `${display.budgetMs.toFixed(2)} ms` : "—"
              }
            />
            <Row
              label="Device pixel ratio"
              value={
                display?.devicePixelRatio != null
                  ? display.devicePixelRatio.toFixed(2)
                  : "—"
              }
            />
            <Row
              label="Physical size"
              value={
                display?.physicalWidth != null && display?.physicalHeight != null
                  ? `${Math.round(display.physicalWidth)} × ${Math.round(display.physicalHeight)} px`
                  : "—"
              }
            />
          </section>

          {extras.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
              <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
                Extras
              </h3>
              <p className="mb-2 text-sm text-[var(--ink-muted)]">
                Optional enricher fields from the app
              </p>
              {extras.map(([key, value]) => (
                <Row key={key} label={key} value={fmtExtra(value)} />
              ))}
            </section>
          )}
        </>
      )}

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
          UI stalls
        </h3>
        <p className="mb-2 text-sm text-[var(--ink-muted)]">
          Main-isolate freezes over the stall threshold — also ranked on{" "}
          <Link href="/problems" className="text-[var(--ink)] underline-offset-2 hover:underline">
            Problems
          </Link>
        </p>
        {!stalls || stalls.available === false || capabilities?.stalls === false ? (
          <p className="text-sm text-[var(--ink-faint)]">
            Stall probe not available (needs pulseflow_flutter ≥ 0.2).
          </p>
        ) : stalls.total === 0 ? (
          <p className="text-sm text-teal-100/90">
            No stalls over {stalls.thresholdMs ?? 250} ms yet.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-3 text-[var(--ink-muted)]">
              <span>
                {stalls.total} stall{stalls.total === 1 ? "" : "s"}
              </span>
              <span>max {stalls.maxDurationMs.toFixed(0)} ms</span>
              <span>threshold {stalls.thresholdMs ?? 250} ms</span>
              {stalls.active && (
                <span className="text-amber-200">probe active</span>
              )}
            </div>
            <ul className="space-y-1.5">
              {[...stalls.stalls]
                .slice(-8)
                .reverse()
                .map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-2 font-mono text-xs"
                  >
                    <span className="text-[var(--ink)]">
                      {s.durationMs.toFixed(0)} ms
                      {s.route ? ` · ${s.route}` : ""}
                    </span>
                    <span className="text-[var(--ink-faint)]">
                      {new Date(s.atMs).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
