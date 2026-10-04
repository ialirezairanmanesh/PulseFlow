"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusVariant } from "@/lib/chart-utils";
import { usePulse } from "@/lib/pulse-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/problems", label: "Problems" },
  { href: "/widgets", label: "Widgets" },
  { href: "/frames", label: "Frames" },
  { href: "/cpu", label: "CPU" },
  { href: "/memory", label: "Memory" },
  { href: "/network", label: "Network" },
  { href: "/tools", label: "Tools" },
  { href: "/report", label: "Report" },
  { href: "/history", label: "History" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    status,
    mode,
    bridgeReady,
    connected,
    statusMessage,
    isolateName,
    disconnect,
    points,
  } = usePulse();

  const latest = points.at(-1);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 atmosphere" aria-hidden />
      <div className="pointer-events-none absolute inset-0 grain" aria-hidden />

      <header className="relative z-10 border-b border-white/8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
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
            <Badge variant={statusVariant(status, mode)}>
              {mode === "mock" && connected ? "demo mode" : status}
            </Badge>
            {!bridgeReady && <Badge variant="idle">bridge…</Badge>}
            {connected && (
              <Button size="sm" variant="danger" onClick={disconnect}>
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            )}
          </div>
        </div>

        {connected && (
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 pb-3 md:px-8">
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
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
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
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 py-6 pb-16 md:px-8">
        {children}
      </main>
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
