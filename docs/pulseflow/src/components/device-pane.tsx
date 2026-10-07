"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  MonitorSmartphone,
  PanelLeftClose,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { mirrorHealthUrl, mirrorStreamUrl } from "@/lib/device-mirror";
import { usePulse } from "@/lib/pulse-store";
import { cn } from "@/lib/utils";

type MirrorStatus = "checking" | "online" | "offline";

export function DevicePane({
  collapsed,
  onCollapse,
  className,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  className?: string;
}) {
  const { mode, deviceSerial, connected } = usePulse();
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("checking");
  const [streamKey, setStreamKey] = useState(0);
  const [streaming, setStreaming] = useState(true);

  const checkMirror = useCallback(async () => {
    setMirrorStatus("checking");
    try {
      const res = await fetch(mirrorHealthUrl(), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      });
      // ws-scrcpy serves 200 on /; offline stub serves 503.
      setMirrorStatus(res.ok ? "online" : "offline");
    } catch {
      setMirrorStatus("offline");
    }
  }, []);

  useEffect(() => {
    void checkMirror();
    const id = setInterval(() => void checkMirror(), 8000);
    return () => clearInterval(id);
  }, [checkMirror]);

  if (collapsed) return null;

  const isDemo = mode === "mock";
  const canStream =
    connected && !isDemo && Boolean(deviceSerial) && mirrorStatus === "online" && streaming;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-white/8 bg-black/25",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Smartphone className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <div className="truncate text-sm text-[var(--ink)]">Device</div>
            <div className="truncate font-mono text-[11px] text-[var(--ink-faint)]">
              {isDemo
                ? "demo mode"
                : deviceSerial
                  ? deviceSerial
                  : "no ADB serial"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            title="Refresh stream"
            onClick={() => {
              void checkMirror();
              setStreamKey((k) => k + 1);
              setStreaming(true);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Hide device pane"
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        {isDemo ? (
          <EmptyState
            icon={<MonitorSmartphone className="h-8 w-8 opacity-50" />}
            title="Demo mode"
            body="Live device preview is available when you connect to a real Flutter app on Android / redroid."
          />
        ) : !deviceSerial ? (
          <EmptyState
            icon={<Smartphone className="h-8 w-8 opacity-50" />}
            title="No device serial"
            body="Reconnect from Find running apps so PulseFlow can pick up the ADB serial (e.g. localhost:5555)."
          />
        ) : mirrorStatus === "offline" ? (
          <EmptyState
            icon={<MonitorSmartphone className="h-8 w-8 opacity-50" />}
            title="Mirror offline"
            body="Start the device mirror sidecar (port 3848). From the repo: make run installs and starts it with the dashboard."
            action={
              <Button size="sm" variant="outline" onClick={() => void checkMirror()}>
                Retry
              </Button>
            }
          />
        ) : mirrorStatus === "checking" ? (
          <EmptyState
            icon={<RefreshCw className="h-8 w-8 animate-spin opacity-50" />}
            title="Checking mirror…"
            body="Looking for the ws-scrcpy sidecar on port 3848."
          />
        ) : !streaming ? (
          <EmptyState
            icon={<Smartphone className="h-8 w-8 opacity-50" />}
            title="Stream stopped"
            body={`Device ${deviceSerial} is ready.`}
            action={
              <Button size="sm" onClick={() => setStreaming(true)}>
                Start stream
              </Button>
            }
          />
        ) : canStream ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="mx-auto flex min-h-0 w-full max-w-[360px] flex-1 flex-col rounded-[1.5rem] border border-white/15 bg-black p-2 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
              <iframe
                key={streamKey}
                title={`Android device ${deviceSerial}`}
                src={mirrorStreamUrl(deviceSerial)}
                className="h-full min-h-[420px] w-full flex-1 rounded-[1.1rem] bg-black"
                allow="autoplay; clipboard-read; clipboard-write"
              />
            </div>
            <div className="mt-2 flex justify-center">
              <Button size="sm" variant="outline" onClick={() => setStreaming(false)}>
                Stop stream
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center">
      {icon}
      <div>
        <div className="text-sm text-[var(--ink)]">{title}</div>
        <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--ink-muted)]">
          {body}
        </p>
      </div>
      {action}
    </div>
  );
}
