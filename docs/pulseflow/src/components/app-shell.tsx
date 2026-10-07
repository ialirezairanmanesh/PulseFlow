"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PanelLeft, Share2, Sparkles, Unplug } from "lucide-react";
import { AiDrawer } from "@/components/ai-drawer";
import { DevicePane } from "@/components/device-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusVariant } from "@/lib/chart-utils";
import { computeVerdict } from "@/lib/verdict";
import { usePulse } from "@/lib/pulse-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/problems", label: "Problems" },
  { href: "/widgets", label: "Widgets" },
  { href: "/frames", label: "Frames" },
  { href: "/cpu", label: "CPU" },
  { href: "/memory", label: "Memory" },
  { href: "/network", label: "Network" },
  { href: "/logs", label: "Logs" },
  { href: "/tools", label: "Tools" },
  { href: "/report", label: "Report" },
  { href: "/history", label: "History" },
  { href: "/ai", label: "AI" },
] as const;

const WIDTH_KEY = "pulseflow.devicePaneWidth";
const COLLAPSED_KEY = "pulseflow.devicePaneCollapsed";
const DEFAULT_WIDTH = 36;
const MIN_WIDTH = 22;
const MAX_WIDTH = 55;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [aiOpen, setAiOpen] = useState(false);
  const [paneWidth, setPaneWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const {
    status,
    mode,
    bridgeReady,
    connected,
    statusMessage,
    isolateName,
    disconnect,
    points,
    sharedView,
    shareView,
  } = usePulse();

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) setPaneWidth(w);
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const persistCollapsed = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const pct = (ev.clientX / window.innerWidth) * 100;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pct));
      setPaneWidth(next);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setPaneWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const latest = points.at(-1);
  const verdict = connected ? computeVerdict({ points, problems: [] }) : null;
  const verdictTone = verdict
    ? verdict.status === "good"
      ? "border-teal-400/25 bg-teal-500/10 text-teal-200"
      : verdict.status === "needs-work"
        ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
        : "border-rose-400/25 bg-rose-500/10 text-rose-200"
    : "";
  const verdictLabel = verdict
    ? verdict.status === "good"
      ? "Good"
      : verdict.status === "needs-work"
        ? "Needs work"
        : "Problems"
    : "";

  const showDeviceSplit = connected;

  return (
    <div className="relative flex h-screen min-h-0 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 atmosphere" aria-hidden />
      <div className="pointer-events-none absolute inset-0 grain" aria-hidden />

      <header className="relative z-10 shrink-0 border-b border-white/8">
        <div
          className={cn(
            "mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6",
            showDeviceSplit ? "max-w-none" : "max-w-6xl",
          )}
        >
          <div className="flex items-center gap-3">
            <Link href={connected ? "/problems" : "/"} className="flex items-center gap-3">
              <motion.span
                className="pulse-orb"
                animate={{
                  scale: connected ? [1, 1.08, 1] : 1,
                  opacity: connected ? [0.85, 1, 0.85] : 0.7,
                }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              <span className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)] md:text-2xl">
                PulseFlow
              </span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showDeviceSplit && collapsed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => persistCollapsed(false)}
                title="Show device pane"
              >
                <PanelLeft className="h-3.5 w-3.5" />
                Device
              </Button>
            )}
            <Badge variant={statusVariant(status, mode)}>
              {mode === "mock" && connected ? "demo mode" : status}
            </Badge>
            {!bridgeReady && <Badge variant="idle">bridge…</Badge>}
            {sharedView && (
              <Badge variant="default" className="border-amber-400/30 bg-amber-500/10 text-amber-200">
                shared view (read-only)
              </Badge>
            )}
            {connected && (
              <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}>
                <Sparkles className="h-3.5 w-3.5" />
                Ask AI
              </Button>
            )}
            {connected && !sharedView && (
              <Button size="sm" variant="outline" onClick={shareView} title="Copy a shareable link to this view">
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>
            )}
            {connected && (
              <Button size="sm" variant="danger" onClick={disconnect}>
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </header>

      {showDeviceSplit ? (
        <div className="relative z-10 flex min-h-0 flex-1">
          {!collapsed && (
            <>
              <div style={{ width: `${paneWidth}%` }} className="min-h-0 shrink-0">
                <DevicePane
                  collapsed={false}
                  onCollapse={() => persistCollapsed(true)}
                  className="h-full"
                />
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize device pane"
                onMouseDown={onDragStart}
                className="group relative z-20 w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-white/10"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 group-hover:bg-[var(--accent)]" />
              </div>
            </>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-white/8 px-5 py-3 md:px-6">
              <nav className="flex flex-wrap gap-1">
                {NAV.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-white/10 text-[var(--ink)]"
                          : "text-[var(--ink-muted)] hover:bg-white/5 hover:text-[var(--ink)]",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
                <p className="min-w-0 truncate">
                  {statusMessage}
                  {isolateName ? ` · isolate ${isolateName}` : ""}
                  {mode === "mock" ? " · labeled demo metrics" : ""}
                </p>
                <div className="flex flex-wrap gap-3">
                  <MiniStat
                    label="Build"
                    value={
                      latest?.buildMs != null ? `${latest.buildMs.toFixed(1)} ms` : "—"
                    }
                  />
                  <MiniStat
                    label="Raster"
                    value={
                      latest?.rasterMs != null ? `${latest.rasterMs.toFixed(1)} ms` : "—"
                    }
                  />
                  <MiniStat
                    label="Heap"
                    value={latest ? `${latest.heapMb.toFixed(1)} MB` : "—"}
                  />
                  {verdict && (
                    <div
                      className={cn(
                        "min-w-[72px] rounded-md border px-2.5 py-1.5",
                        verdictTone,
                      )}
                    >
                      <div className="text-[10px] uppercase tracking-[0.14em] opacity-70">
                        Health
                      </div>
                      <div className="font-[family-name:var(--font-display)] text-sm">
                        {verdictLabel} · {verdict.score}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 pb-16 md:px-6">
              {children}
            </main>
          </div>
        </div>
      ) : (
        <>
          <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-3 md:px-8">
            {/* connect layout keeps prior header-only chrome */}
          </div>
          <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-5 py-6 pb-16 md:px-8">
            {children}
          </main>
        </>
      )}

      <AiDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[72px] rounded-md border border-white/8 bg-white/5 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="font-[family-name:var(--font-display)] text-sm text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}
