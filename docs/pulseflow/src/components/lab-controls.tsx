"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExtensionInfo, ScenarioInfo, SessionBaseline } from "@/lib/types";
import { Cpu, MemoryStick, PackagePlus, Play, Square, Zap } from "lucide-react";

export function LabControls({
  extension,
  disabled,
  scenarios,
  scenarioRunning,
  scenarioMessage,
  baselines,
  onStress,
  onRefresh,
  onListScenarios,
  onRunScenario,
  onStopScenario,
  onCaptureBaseline,
  onClearBaselines,
}: {
  extension: ExtensionInfo | null;
  disabled: boolean;
  scenarios: ScenarioInfo[];
  scenarioRunning: string | null;
  scenarioMessage?: string;
  baselines: SessionBaseline[];
  onStress: (action: string, params?: Record<string, unknown>) => void;
  onRefresh: () => void;
  onListScenarios: () => void;
  onRunScenario: (id: string, params?: Record<string, unknown>) => void;
  onStopScenario: () => void;
  onCaptureBaseline: (label: string) => void;
  onClearBaselines: () => void;
}) {
  const available = extension?.available ?? false;
  const [scenarioId, setScenarioId] = useState<string>("");
  const [invoiceCount, setInvoiceCount] = useState(100);
  const [cpuMillis, setCpuMillis] = useState(800);
  const [megabytes, setMegabytes] = useState(32);

  useEffect(() => {
    onListScenarios();
  }, [onListScenarios]);

  const effectiveScenarioId = scenarioId || scenarios[0]?.id || "";
  const selected = scenarios.find((s) => s.id === effectiveScenarioId);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Stress controls
            </h3>
            <p className="text-sm text-[var(--ink-muted)]">
              Trigger load so spikes appear on Frames / Memory / Network
            </p>
          </div>
          <Badge variant={available ? "live" : "idle"}>
            {available ? "extension ready" : "extension missing"}
          </Badge>
        </div>

        {!available && (
          <p className="mb-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            {extension?.message ??
              "PulseFlow VM service extension not detected. Paste the Flutter stub from the README into your app, hot-restart, then reconnect."}
          </p>
        )}

        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-[var(--ink-faint)]">
            Invoice count
            <Input
              type="number"
              className="mt-1"
              value={invoiceCount}
              onChange={(e) => setInvoiceCount(Number(e.target.value) || 0)}
            />
          </label>
          <label className="text-xs text-[var(--ink-faint)]">
            CPU spike ms
            <Input
              type="number"
              className="mt-1"
              value={cpuMillis}
              onChange={(e) => setCpuMillis(Number(e.target.value) || 0)}
            />
          </label>
          <label className="text-xs text-[var(--ink-faint)]">
            Allocate MB
            <Input
              type="number"
              className="mt-1"
              value={megabytes}
              onChange={(e) => setMegabytes(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !available}
            onClick={() => onStress("injectInvoices", { count: invoiceCount })}
          >
            <PackagePlus className="h-4 w-4" />
            Inject invoices
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !available}
            onClick={() => onStress("spikeCpu", { millis: cpuMillis })}
          >
            <Cpu className="h-4 w-4" />
            Spike CPU
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !available}
            onClick={() => onStress("allocateMemory", { megabytes })}
          >
            <MemoryStick className="h-4 w-4" />
            Allocate memory
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onRefresh}>
            <Zap className="h-4 w-4" />
            Retry detect
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <div className="mb-3">
          <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Scenario runner
          </h3>
          <p className="text-sm text-[var(--ink-muted)]">
            Repeatable lab scenarios — watch Problems / Frames / Widgets react
          </p>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-xs text-[var(--ink-faint)]">
            Scenario
            <select
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-[var(--ink)]"
              value={effectiveScenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              disabled={disabled || !scenarios.length}
            >
              {scenarios.length === 0 && <option value="">No scenarios</option>}
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={disabled || !effectiveScenarioId || Boolean(scenarioRunning)}
            onClick={() => onRunScenario(effectiveScenarioId)}
          >
            <Play className="h-4 w-4" />
            Run
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !scenarioRunning}
            onClick={onStopScenario}
          >
            <Square className="h-4 w-4" />
            Stop
          </Button>
        </div>

        {selected && (
          <p className="mb-2 text-sm text-[var(--ink-muted)]">{selected.description}</p>
        )}
        {scenarioRunning && (
          <Badge variant="live">Running {scenarioRunning}</Badge>
        )}
        {scenarioMessage && (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">{scenarioMessage}</p>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
              Before / after baselines
            </h3>
            <p className="text-sm text-[var(--ink-muted)]">
              Capture frame P95, rebuild rate, and heap for comparison
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onCaptureBaseline("before")}>
              Capture before
            </Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onCaptureBaseline("after")}>
              Capture after
            </Button>
            <Button size="sm" variant="outline" disabled={!baselines.length} onClick={onClearBaselines}>
              Clear
            </Button>
          </div>
        </div>
        {baselines.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No baselines yet</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {baselines.map((b) => (
              <li
                key={b.id}
                className="rounded-md border border-white/8 bg-white/5 px-3 py-2 text-[var(--ink-muted)]"
              >
                <span className="text-[var(--ink)]">{b.label}</span>
                {" · "}
                P95 build {b.p95BuildMs} ms · rebuild {b.rebuildRate}/s · heap {b.heapMb} MB ·
                jank {(b.jankRatio * 100).toFixed(0)}%
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
