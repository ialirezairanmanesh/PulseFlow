"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { ChartShell } from "@/components/chart-shell";
import { Button } from "@/components/ui/button";
import { FRAME_BUDGET, healthFromPoint, normalizePoint, tooltipStyle } from "@/lib/chart-utils";
import { usePulse } from "@/lib/pulse-store";
import { formatMs } from "@/lib/utils";

export function FrameCharts() {
  const {
    points,
    connected,
    timelineMarkers,
    timelineMessage,
    exportTimeline,
    capabilities,
  } = usePulse();
  const normalized = points.map(normalizePoint);
  const chartData = normalized.map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleTimeString([], {
      minute: "2-digit",
      second: "2-digit",
    }),
  }));
  const latest = normalized[normalized.length - 1];
  const jankCount = normalized.filter((p) => p.jank).length;
  const health = healthFromPoint(latest, jankCount);

  const toneClass =
    health.tone === "good"
      ? "border-teal-400/30 bg-teal-500/10 text-teal-100"
      : health.tone === "warn"
        ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
        : health.tone === "bad"
          ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
          : "border-white/10 bg-white/5 text-[var(--ink-muted)]";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Frames
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Build vs Raster and frame pressure against the 16.67 ms budget
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!connected}
          title={
            capabilities?.perfettoTimeline === false
              ? "Perfetto may fall back to JSON timeline"
              : "Export recent VM timeline"
          }
          onClick={() => exportTimeline(5000)}
        >
          Export Perfetto
        </Button>
      </div>

      {timelineMessage && (
        <p className="text-sm text-[var(--ink-muted)]">{timelineMessage}</p>
      )}

      {timelineMarkers.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-sm">
          <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            Timeline markers
          </div>
          <div className="flex flex-wrap gap-2">
            {[...timelineMarkers].slice(-24).map((m) => (
              <span
                key={m.id}
                className={
                  m.kind === "jank"
                    ? "rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-100"
                    : m.kind === "gc"
                      ? "rounded-md border border-lime-400/30 bg-lime-500/10 px-2 py-1 text-xs text-lime-100"
                      : m.kind === "shader"
                        ? "rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100"
                        : "rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--ink-muted)]"
                }
                title={new Date(m.t).toLocaleTimeString()}
              >
                {m.kind}: {m.label}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className={`rounded-xl border px-4 py-3 ${toneClass}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-80">Frame status</div>
            <div className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              {health.label}
            </div>
          </div>
          {latest && (
            <div className="flex flex-wrap gap-3 text-sm opacity-90">
              <span>Build {formatMs(latest.buildMs)}</span>
              <span>Raster {formatMs(latest.rasterMs)}</span>
              <span>Frame pressure {Math.round(latest.framePressure)}%</span>
            </div>
          )}
        </div>
        <p className="mt-1 text-sm opacity-90">{health.reason}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartShell
          title="Frame time: Build & Raster"
          subtitle="Build = widget/layout · Raster = GPU paint · red line = 16.67ms budget"
          loading={connected && points.length === 0}
          empty={!connected ? "Connect to see Build and Raster times" : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="buildFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rasterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#7f9aa0", fontSize: 11 }} minTickGap={28} />
              <YAxis
                tick={{ fill: "#7f9aa0", fontSize: 11 }}
                width={36}
                unit="ms"
                tickFormatter={(v) => String(Math.round(Number(v)))}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [`${Number(value).toFixed(2)} ms`, String(name)]}
              />
              <ReferenceLine y={FRAME_BUDGET} stroke="#fb7185" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="buildMs"
                name="Build"
                stroke="#2dd4bf"
                fill="url(#buildFill)"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="rasterMs"
                name="Raster"
                stroke="#38bdf8"
                fill="url(#rasterFill)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Frame pressure"
          subtitle="Share of the 16ms budget used (not OS CPU %)"
          loading={connected && points.length === 0}
          empty={!connected ? "Connect to see frame pressure" : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="pressureFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#7f9aa0", fontSize: 11 }} minTickGap={28} />
              <YAxis tick={{ fill: "#7f9aa0", fontSize: 11 }} width={36} domain={[0, 100]} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${Number(value).toFixed(1)}%`, "Pressure"]}
              />
              <ReferenceLine y={70} stroke="#fbbf24" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="framePressure"
                name="Pressure"
                stroke="#fb7185"
                fill="url(#pressureFill)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>
    </div>
  );
}
