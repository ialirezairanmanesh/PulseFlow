"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MonitorSmartphone,
  PanelLeftClose,
  RefreshCw,
  RotateCw,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { mirrorStreamUrl } from "@/lib/device-mirror";
import {
  containSize,
  DEFAULT_MIRROR_SIZE,
  formatMirrorSize,
  mirrorAspect,
  MIRROR_SIZE_PRESETS,
  parseMirrorSize,
  presetForSize,
  swapSize,
  type MirrorSize,
} from "@/lib/mirror-fit";
import { usePulse } from "@/lib/pulse-store";
import { cn } from "@/lib/utils";

type MirrorStatus = "checking" | "online" | "offline";

const SIZE_KEY = "pulseflow.devicePaneSize";

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
  const [size, setSize] = useState<MirrorSize>(DEFAULT_MIRROR_SIZE);
  const [wText, setWText] = useState(String(DEFAULT_MIRROR_SIZE.w));
  const [hText, setHText] = useState(String(DEFAULT_MIRROR_SIZE.h));
  const frameAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = parseMirrorSize(localStorage.getItem(SIZE_KEY));
    if (saved) {
      setSize(saved);
      setWText(String(saved.w));
      setHText(String(saved.h));
    }
  }, []);

  const commitSize = useCallback((next: MirrorSize) => {
    setSize(next);
    setWText(String(next.w));
    setHText(String(next.h));
    try {
      localStorage.setItem(SIZE_KEY, formatMirrorSize(next));
    } catch {
      /* ignore */
    }
  }, []);

  const applyTextSize = useCallback(() => {
    const w = Number(wText);
    const h = Number(hText);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      commitSize({ w: Math.round(w), h: Math.round(h) });
    } else {
      setWText(String(size.w));
      setHText(String(size.h));
    }
  }, [wText, hText, size.w, size.h, commitSize]);

  // Background polls must NOT flip status to "checking" — that unmounts the
  // iframe (canStream requires "online") and reloads the stream every interval.
  const checkMirror = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setMirrorStatus("checking");
    try {
      // Same-origin API — direct fetch to :3848 is cross-origin and blocked
      // because ws-scrcpy does not send Access-Control-Allow-Origin.
      const res = await fetch("/api/mirror-health", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      setMirrorStatus(res.ok ? "online" : "offline");
    } catch {
      setMirrorStatus("offline");
    }
  }, []);

  useEffect(() => {
    void checkMirror();
    const id = setInterval(() => void checkMirror({ quiet: true }), 8000);
    return () => clearInterval(id);
  }, [checkMirror]);

  // The pane shows the stream at the chosen device size's aspect ratio, scaled
  // to fit (contain). ws-scrcpy encodes to the iframe body once at load, so the
  // frame is reloaded whenever the size changes to keep the fit exact.
  const aspect = mirrorAspect(size);
  const presetId = presetForSize(size)?.id ?? "custom";
  const isDemo = mode === "mock";
  const canStream =
    connected && !isDemo && Boolean(deviceSerial) && mirrorStatus === "online" && streaming;
  const frameSize = useContainedSize(frameAreaRef, aspect, canStream);

  if (collapsed) return null;

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

      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2 text-xs text-[var(--ink-muted)]">
        <select
          aria-label="Device size"
          value={presetId}
          onChange={(e) => {
            const preset = MIRROR_SIZE_PRESETS.find((p) => p.id === e.target.value);
            if (preset) commitSize({ w: preset.w, h: preset.h });
          }}
          className="rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        >
          {MIRROR_SIZE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        <div className="flex items-center gap-1">
          <input
            aria-label="Device width"
            type="number"
            min={1}
            inputMode="numeric"
            value={wText}
            onChange={(e) => setWText(e.target.value)}
            onBlur={applyTextSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyTextSize();
            }}
            className="w-16 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-center font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          />
          <span className="text-[var(--ink-faint)]">×</span>
          <input
            aria-label="Device height"
            type="number"
            min={1}
            inputMode="numeric"
            value={hText}
            onChange={(e) => setHText(e.target.value)}
            onBlur={applyTextSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyTextSize();
            }}
            className="w-16 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-center font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          />
          <Button
            size="sm"
            variant="ghost"
            title="Swap width and height"
            onClick={() => commitSize(swapSize(size))}
          >
            <RotateCw className="h-3.5 w-3.5" />
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
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={frameAreaRef}
              className="flex min-h-0 flex-1 items-center justify-center"
            >
              <div
                className="relative overflow-hidden rounded-xl border border-white/15 bg-black shadow-[0_0_40px_rgba(0,0,0,0.45)]"
                style={
                  frameSize
                    ? { width: frameSize.w, height: frameSize.h }
                    : { height: "100%", aspectRatio: String(aspect), maxWidth: "100%" }
                }
              >
                <iframe
                  key={`${streamKey}-${formatMirrorSize(size)}`}
                  title={`Android device ${deviceSerial}`}
                  src={mirrorStreamUrl(deviceSerial)}
                  className="absolute inset-0 h-full w-full rounded-lg border-0 bg-black"
                  allow="autoplay; clipboard-read; clipboard-write"
                />
              </div>
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

/** Size a box of `aspect` (w/h) to fit inside the observed element (contain). */
function useContainedSize(
  ref: React.RefObject<HTMLDivElement | null>,
  aspect: number,
  enabled: boolean,
): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setSize(null);
      return;
    }
    const update = () => {
      setSize(containSize(el.clientWidth, el.clientHeight, aspect));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect, enabled]);

  return size;
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
