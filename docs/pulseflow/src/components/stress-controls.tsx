"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExtensionInfo } from "@/lib/types";
import { Zap, PackagePlus, Cpu, MemoryStick } from "lucide-react";

export function StressControls({
  extension,
  disabled,
  onStress,
  onRefresh,
}: {
  extension: ExtensionInfo | null;
  disabled: boolean;
  onStress: (action: string, params?: Record<string, unknown>) => void;
  onRefresh: () => void;
}) {
  const available = extension?.available ?? false;

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Stress test controller
          </h3>
          <p className="text-sm text-[var(--ink-muted)]">
            Trigger load in the connected Flutter app so spikes appear on the graphs
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

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled || !available}
          onClick={() => onStress("injectInvoices", { count: 100 })}
        >
          <PackagePlus className="h-4 w-4" />
          Inject 100 invoices
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !available}
          onClick={() => onStress("spikeCpu", { millis: 800 })}
        >
          <Cpu className="h-4 w-4" />
          Spike CPU
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !available}
          onClick={() => onStress("allocateMemory", { megabytes: 32 })}
        >
          <MemoryStick className="h-4 w-4" />
          Allocate 32 MB
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onRefresh}>
          <Zap className="h-4 w-4" />
          Retry detect
        </Button>
      </div>
    </section>
  );
}
