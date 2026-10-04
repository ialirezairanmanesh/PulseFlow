"use client";

import { useMemo, useState } from "react";
import { FlameGraph } from "react-flame-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePulse } from "@/lib/pulse-store";

const DURATIONS = [3000, 5000, 10000] as const;

export function CpuPanel() {
  const {
    connected,
    capabilities,
    cpuProfile,
    cpuRecording,
    cpuMessage,
    startCpuRecord,
    stopCpuRecord,
    exportCpu,
  } = usePulse();
  const [durationMs, setDurationMs] = useState<number>(5000);

  const available = capabilities?.cpuSamples !== false;
  const flameData = useMemo(() => {
    if (!cpuProfile?.flameRoot) return null;
    return cpuProfile.flameRoot;
  }, [cpuProfile]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            CPU
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Record a short profile — top functions and a flamegraph. Prefer Flutter{" "}
            <span className="text-[var(--ink)]">profile</span> mode.
          </p>
        </div>
        <Badge variant={available ? "live" : "idle"}>
          {available ? "profiler ready" : "unavailable"}
        </Badge>
      </div>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {DURATIONS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={durationMs === d ? "default" : "outline"}
              disabled={cpuRecording}
              onClick={() => setDurationMs(d)}
            >
              {d / 1000}s
            </Button>
          ))}
          <Button
            size="sm"
            disabled={!connected || cpuRecording || capabilities?.cpuSamples === false}
            onClick={() => startCpuRecord(durationMs)}
          >
            {cpuRecording ? "Recording…" : "Record"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!connected || !cpuRecording}
            onClick={() => stopCpuRecord()}
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || !cpuProfile}
            onClick={() => exportCpu(cpuProfile?.durationMs)}
          >
            Export speedscope
          </Button>
        </div>
        {cpuMessage && (
          <p className="text-sm text-[var(--ink-muted)]">{cpuMessage}</p>
        )}
        {capabilities?.cpuSamples === false && (
          <p className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            getCpuSamples is not available on this VM. Run the app in profile mode with the
            CPU profiler enabled.
          </p>
        )}
      </section>

      {cpuProfile && (
        <>
          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="mb-2 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Top functions
            </h3>
            <p className="mb-3 text-xs text-[var(--ink-faint)]">
              {cpuProfile.sampleCount} samples · {cpuProfile.durationMs} ms window
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  <tr>
                    <th className="pb-2 pr-3 font-normal">Function</th>
                    <th className="pb-2 pr-3 font-normal">Self %</th>
                    <th className="pb-2 pr-3 font-normal">Total %</th>
                    <th className="pb-2 font-normal">Self ms</th>
                  </tr>
                </thead>
                <tbody>
                  {cpuProfile.topFunctions.map((fn) => (
                    <tr key={fn.qualifiedName} className="border-t border-white/5">
                      <td className="py-2 pr-3">
                        <div className="text-[var(--ink)]">{fn.name}</div>
                        <div className="truncate text-xs text-[var(--ink-faint)]">
                          {fn.qualifiedName}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-[var(--ink)]">{fn.selfPercent}%</td>
                      <td className="py-2 pr-3 text-[var(--ink-muted)]">{fn.totalPercent}%</td>
                      <td className="py-2 text-[var(--ink-muted)]">{fn.selfMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Flamegraph
            </h3>
            {flameData ? (
              <div className="overflow-x-auto rounded-md bg-black/40 p-2">
                <FlameGraph data={flameData} height={280} width={900} />
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">No flame data</p>
            )}
          </section>
        </>
      )}

      {!cpuProfile && connected && !cpuRecording && (
        <p className="text-sm text-[var(--ink-muted)]">
          Record a profile to see hotspots. Interact with the app while recording.
        </p>
      )}
    </div>
  );
}
