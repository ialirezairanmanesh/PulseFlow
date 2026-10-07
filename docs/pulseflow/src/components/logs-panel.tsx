"use client";

import { Bug, CheckCircle, Info, AlertTriangle, Activity, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePulse } from "@/lib/pulse-store";
import type { ReactNode } from "react";

const LEVEL_ICON: Record<string, ReactNode> = {
  debug: <Activity className="h-3 w-3 text-[var(--ink-faint)]" />,
  info: <Info className="h-3 w-3 text-cyan-300" />,
  warning: <AlertTriangle className="h-3 w-3 text-amber-300" />,
  error: <Bug className="h-3 w-3 text-orange-300" />,
  severe: <Bug className="h-3 w-3 text-rose-300" />,
};

const LEVEL_BG: Record<string, string> = {
  debug: "bg-white/4",
  info: "bg-cyan-500/10",
  warning: "bg-amber-500/10",
  error: "bg-orange-500/10",
  severe: "bg-rose-500/10",
};

export function LogsPanel() {
  const { logs, logMessage, logControl, connected } = usePulse();

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            Logs
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Runtime log stream from the VM Service <code className="font-mono">Logging</code> channel
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected && logs.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => logControl("clear")}
              title="Clear the local log buffer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          {!connected && logs.length === 0 && (
            <span className="text-sm text-[var(--ink-faint)]">Connect a device to stream logs.</span>
          )}
        </div>
      </div>

      {logMessage && (
        <p className="rounded-md border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-sm text-teal-100">
          {logMessage}
        </p>
      )}

      {logs.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
          <CheckCircle className="mx-auto mb-2 h-5 w-5 text-[var(--ink-faint)]" />
          No log entries yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...logs].reverse().map((l) => (
            <div
              key={l.id}
              className={`rounded-md border border-white/8 px-3 py-2 font-mono text-xs ${LEVEL_BG[l.level] ?? LEVEL_BG.debug}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">{LEVEL_ICON[l.level] ?? LEVEL_ICON.debug}</span>
                  <span className="whitespace-pre-wrap break-all">{l.message}</span>
                </div>
                <div className="flex items-center gap-1.5 text-right text-[var(--ink-faint)]">
                  <span className="uppercase">{l.level}</span>
                  {l.loggerName && <span>· {l.loggerName}</span>}
                  <span>· {new Date(l.t).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
