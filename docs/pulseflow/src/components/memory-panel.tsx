"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartShell } from "@/components/chart-shell";
import { Button } from "@/components/ui/button";
import { normalizePoint, tooltipStyle } from "@/lib/chart-utils";
import { usePulse } from "@/lib/pulse-store";
import { formatBytes } from "@/lib/utils";

type Tab = "live" | "snapshots" | "diff" | "leaks";

export function MemoryPanel() {
  const {
    points,
    gcEvents,
    connected,
    memorySnapshots,
    memoryDiff,
    retainingPath,
    memoryMessage,
    capabilities,
    leaks,
    images,
    captureMemorySnapshot,
    diffMemorySnapshots,
    requestRetainingPath,
    leakControl,
  } = usePulse();
  const [tab, setTab] = useState<Tab>("live");
  const normalized = points.map(normalizePoint);
  const chartData = normalized.map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleTimeString([], {
      minute: "2-digit",
      second: "2-digit",
    }),
  }));
  const latest = normalized[normalized.length - 1];
  const allocOk = capabilities?.allocationProfile !== false;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Memory
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Heap chart, allocation snapshots, and A/B diff
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["live", "Live"],
              ["snapshots", "Snapshots"],
              ["diff", "Diff"],
              ["leaks", "Leaks"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? "default" : "outline"}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {tab === "live" && (
        <>
          <ChartShell
            title="Memory (Heap)"
            subtitle={
              latest
                ? `Heap ${latest.heapMb.toFixed(1)} MB · ${gcEvents.length} GC events in window`
                : "Rising heap and GC mean heavy allocation or retained objects"
            }
            loading={connected && points.length === 0}
            empty={!connected ? "Connect to see memory" : undefined}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="heapFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a3e635" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#a3e635" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#7f9aa0", fontSize: 11 }} minTickGap={28} />
                <YAxis tick={{ fill: "#7f9aa0", fontSize: 11 }} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [`${Number(value).toFixed(2)} MB`, "Heap"]}
                />
                <Area
                  type="monotone"
                  dataKey="heapMb"
                  name="Heap MB"
                  stroke="#a3e635"
                  fill="url(#heapFill)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartShell>

          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              GC events
            </h3>
            {gcEvents.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">No GC events yet</p>
            ) : (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-[var(--ink-muted)]">
                {[...gcEvents].reverse().map((e) => (
                  <li key={e.id}>
                    {new Date(e.t).toLocaleTimeString()} — {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Images
            </h3>
            {!images ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">No image data yet</p>
            ) : !images.available ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                Image tracking is available in debug/profile builds.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  Cache {formatBytes(images.cache.currentSizeBytes)} /{" "}
                  {formatBytes(images.cache.maximumSizeBytes)} · {images.cache.currentSize} entries ·{" "}
                  {images.cache.live} live · {images.cache.pending} pending
                </p>
                {images.oversized.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    No oversized decodes detected
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {images.oversized.slice(0, 8).map((img) => (
                      <li
                        key={img.source}
                        className="rounded-md border border-white/8 bg-white/5 px-3 py-2 text-[var(--ink-muted)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="truncate text-[var(--ink)]">{img.source}</span>
                          <span>
                            +{formatBytes(img.overheadBytes)} overhead · {img.count}×
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--ink-faint)]">
                          decoded {formatBytes(img.decodedBytes)} · shown{" "}
                          {formatBytes(img.displayBytes)} — add cacheWidth/cacheHeight
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}

      {tab === "snapshots" && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!connected || !allocOk}
              onClick={() => captureMemorySnapshot()}
            >
              Capture snapshot
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={memorySnapshots.length < 1}
              onClick={() => {
                const last = memorySnapshots.at(-1);
                if (last?.classes[0]?.classId) {
                  requestRetainingPath(last.classes[0].classId);
                } else {
                  requestRetainingPath();
                }
              }}
            >
              Retaining path (best effort)
            </Button>
          </div>
          {memoryMessage && (
            <p className="mb-3 text-sm text-[var(--ink-muted)]">{memoryMessage}</p>
          )}
          {!allocOk && (
            <p className="mb-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              Allocation profile unavailable on this VM.
            </p>
          )}
          {memorySnapshots.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No snapshots yet</p>
          ) : (
            <div className="space-y-4">
              {[...memorySnapshots].reverse().map((snap) => (
                <div key={snap.id}>
                  <h4 className="mb-1 text-sm text-[var(--ink)]">
                    {new Date(snap.t).toLocaleTimeString()} · heap {snap.heapMb.toFixed(1)} MB
                  </h4>
                  <ul className="space-y-1 text-sm text-[var(--ink-muted)]">
                    {snap.classes.slice(0, 12).map((c) => (
                      <li key={`${snap.id}-${c.className}`}>
                        {c.className} — {c.instances} inst · {formatBytes(c.bytes)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {retainingPath && retainingPath.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-sm text-[var(--ink)]">Retaining path</h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--ink-muted)]">
                {retainingPath.map((n, i) => (
                  <li key={`${n.label}-${i}`}>
                    {n.label}
                    {n.kind ? ` (${n.kind})` : ""}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {tab === "diff" && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!connected || memorySnapshots.length < 2}
              onClick={() => diffMemorySnapshots()}
            >
              Diff last two snapshots
            </Button>
          </div>
          {memoryMessage && (
            <p className="mb-3 text-sm text-[var(--ink-muted)]">{memoryMessage}</p>
          )}
          {!memoryDiff?.grew?.length ? (
            <p className="text-sm text-[var(--ink-muted)]">
              Capture two snapshots, then diff to see growing classes
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {memoryDiff.grew.map((g) => (
                <li
                  key={g.className}
                  className="rounded-md border border-white/8 bg-white/5 px-3 py-2 text-[var(--ink-muted)]"
                >
                  <span className="text-[var(--ink)]">{g.className}</span>
                  {" · "}+{formatBytes(g.bytesDelta)} · +{g.instancesDelta} instances
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "leaks" && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!connected}
              onClick={() => leakControl("report")}
            >
              Report leaks
            </Button>
            <span className="text-xs text-[var(--ink-faint)]">
              Outstanding objects (created but not disposed) — debug/profile only
            </span>
          </div>
          {memoryMessage && (
            <p className="mb-3 text-sm text-[var(--ink-muted)]">{memoryMessage}</p>
          )}
          {leaks.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">
              {connected
                ? "No leak report yet — click Report leaks (requires a debug/profile build)."
                : "Connect to inspect leaks"}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {leaks.map((l) => (
                <li
                  key={l.className}
                  className="rounded-md border border-white/8 bg-white/5 px-3 py-2 text-[var(--ink-muted)]"
                >
                  <span className="text-[var(--ink)]">{l.className}</span>
                  {" · "}
                  {l.count} outstanding
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
