"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartShell } from "@/components/chart-shell";
import { Button } from "@/components/ui/button";
import { tooltipStyle } from "@/lib/chart-utils";
import { usePulse } from "@/lib/pulse-store";
import type { NetworkRequest } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

function groupSlowest(requests: NetworkRequest[]) {
  const map = new Map<string, { uri: string; count: number; total: number; max: number }>();
  for (const r of requests) {
    const key = `${r.method} ${r.uri}`;
    const cur = map.get(key) ?? { uri: key, count: 0, total: 0, max: 0 };
    cur.count += 1;
    cur.total += r.latencyMs;
    cur.max = Math.max(cur.max, r.latencyMs);
    map.set(key, cur);
  }
  return [...map.values()]
    .map((g) => ({ ...g, avg: g.total / g.count }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 8);
}

export function NetworkPanel() {
  const {
    network,
    sockets,
    networkAvailable,
    networkMessage,
    connected,
    networkControl,
  } = usePulse();

  const ordered = [...network].sort((a, b) => a.t - b.t);
  const minStart = ordered.reduce(
    (m, r) => Math.min(m, r.startMs ?? r.t),
    Number.POSITIVE_INFINITY,
  );
  const slowest = groupSlowest(network);
  const span = Math.max(
    1,
    ...ordered.map((r) => (r.endMs ?? r.startMs ?? r.t) - (Number.isFinite(minStart) ? minStart : 0)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Network
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Full HTTP profile, latency waterfall, and slowest endpoints
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!connected} onClick={() => networkControl("refresh")}>
            Refresh
          </Button>
          <Button size="sm" variant="outline" disabled={!connected} onClick={() => networkControl("enable")}>
            Enable
          </Button>
          <Button size="sm" variant="outline" disabled={!connected} onClick={() => networkControl("clear")}>
            Clear
          </Button>
        </div>
      </div>

      <ChartShell
        title="Network latency"
        subtitle={
          networkAvailable === false
            ? networkMessage ?? "HTTP profile not available on this VM"
            : network.length
              ? `${network.length} requests in buffer`
              : "If HttpProfile is exposed, API latency shows here"
        }
        loading={connected && networkAvailable === null && network.length === 0}
        empty={
          !connected
            ? "Connect to see requests"
            : networkAvailable === false
              ? networkMessage
              : network.length === 0
                ? networkMessage ?? "No samples yet"
                : undefined
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={network.slice(-20)}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="method" tick={{ fill: "#7f9aa0", fontSize: 11 }} />
            <YAxis tick={{ fill: "#7f9aa0", fontSize: 11 }} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, _n, item) => {
                const r = item?.payload as NetworkRequest | undefined;
                return [
                  `${Number(value).toFixed(1)} ms · ${formatBytes(r?.responseBytes ?? 0)}`,
                  r?.uri ?? "request",
                ];
              }}
            />
            <Bar dataKey="latencyMs" fill="#38bdf8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartShell>

      {slowest.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Slowest endpoints
          </h3>
          <ul className="space-y-2 text-sm text-[var(--ink-muted)]">
            {slowest.map((g) => (
              <li key={g.uri}>
                <span className="text-[var(--ink)]">{g.uri}</span>
                {" · "}max {g.max.toFixed(0)} ms · avg {g.avg.toFixed(0)} ms · n={g.count}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ordered.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Waterfall
          </h3>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {ordered.slice(-40).map((r) => {
              const start = (r.startMs ?? r.t) - (Number.isFinite(minStart) ? minStart : 0);
              const width = Math.max(2, (r.latencyMs / span) * 100);
              const left = Math.max(0, (start / span) * 100);
              return (
                <div key={r.id} className="grid grid-cols-[140px_1fr] items-center gap-2 text-xs">
                  <div className="truncate text-[var(--ink-muted)]">
                    {r.method} {r.status ?? ""}
                  </div>
                  <div className="relative h-5 rounded bg-white/5">
                    <div
                      className="absolute top-0.5 h-4 rounded bg-sky-400/70"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${r.uri} · ${r.latencyMs} ms`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {network.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Requests
          </h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
            {[...network].reverse().slice(0, 60).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-white/8 bg-white/5 px-3 py-2"
              >
                <span className="text-[var(--ink)]">
                  {r.method} {r.uri}
                </span>
                <span className="text-[var(--ink-muted)]">
                  {r.latencyMs.toFixed(1)} ms · {r.status ?? "—"} ·{" "}
                  {formatBytes(r.responseBytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sockets.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Sockets
          </h3>
          <ul className="space-y-1 text-sm text-[var(--ink-muted)]">
            {sockets.map((s) => (
              <li key={s.id}>
                {s.address}
                {s.port != null ? `:${s.port}` : ""} — r {formatBytes(s.readBytes)} / w{" "}
                {formatBytes(s.writeBytes)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
