"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Link2, LoaderCircle, Radio, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statusVariant } from "@/lib/chart-utils";
import { usePulse } from "@/lib/pulse-store";

export function ConnectHero() {
  const router = useRouter();
  const {
    url,
    setUrl,
    bridgeReady,
    status,
    mode,
    statusMessage,
    error,
    connected,
    discovered,
    discovering,
    connect,
    mock,
    discover,
  } = usePulse();

  useEffect(() => {
    if (connected) {
      router.replace("/problems");
    }
  }, [connected, router]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 atmosphere" aria-hidden />
      <div className="pointer-events-none absolute inset-0 grain" aria-hidden />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <div className="flex items-center gap-3">
          <motion.span
            className="pulse-orb"
            animate={{ scale: 1, opacity: 0.7 }}
          />
          <span className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)] md:text-2xl">
            PulseFlow
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(status, mode)}>{status}</Badge>
          {!bridgeReady && <Badge variant="idle">bridge…</Badge>}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 md:px-8">
        <motion.section
          initial={{ opacity: 1, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="grid min-h-[72vh] items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-tight text-[var(--ink)] sm:text-6xl md:text-7xl">
              PulseFlow
            </h1>
            <p className="mt-5 max-w-md text-lg text-[var(--ink-muted)]">
              Find which widgets on which Flutter screens cause rebuilds and jank — then fix them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={discover}
                disabled={!bridgeReady || discovering}
              >
                {discovering ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {discovering ? "Scanning…" : "Find running apps"}
              </Button>
              <Button size="lg" variant="secondary" onClick={mock} disabled={!bridgeReady}>
                <Radio className="h-4 w-4" />
                Try demo mode
              </Button>
            </div>
          </div>

          <motion.div
            className="connect-panel"
            initial={{ opacity: 1, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="mb-4 flex items-center gap-2 text-[var(--accent)]">
              <Activity className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                Connection manager
              </span>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between gap-2">
                <Label>Local Flutter apps</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={discover}
                  disabled={!bridgeReady || discovering}
                >
                  {discovering ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  {discovering ? "Scanning…" : "Scan"}
                </Button>
              </div>
              <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                {discovered.length === 0 ? (
                  <p className="rounded-md border border-white/8 bg-white/4 px-3 py-2 text-sm text-[var(--ink-faint)]">
                    {discovering
                      ? "Looking for Dart VM Services on this machine…"
                      : "No apps listed yet — click Scan, or paste a URL below."}
                  </p>
                ) : (
                  discovered.map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--ink)]">{app.name}</div>
                        <div className="truncate font-mono text-[11px] text-[var(--ink-faint)]">
                          :{app.port}
                          {app.detail ? ` · ${app.detail}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={app.connectable ? "default" : "secondary"}
                        disabled={!bridgeReady || status === "connecting"}
                        onClick={() => {
                          setUrl(app.wsUrl);
                          if (app.connectable) connect(app.wsUrl);
                        }}
                      >
                        {app.connectable ? "Connect" : "Use URL"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Label htmlFor="vm-url">VM Service WebSocket URL</Label>
            <Input
              id="vm-url"
              className="mt-2 font-mono text-[13px]"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://127.0.0.1:xxxx/ws"
              disabled={status === "connecting"}
            />
            <p className="mt-2 text-sm text-[var(--ink-faint)]">
              Auto-scan finds many local services. If auth is required, paste the full URL from{" "}
              <code className="text-[var(--accent)]">flutter run</code> (includes the token).
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                onClick={() => connect()}
                disabled={!bridgeReady || status === "connecting"}
              >
                {status === "connecting" ? "Connecting…" : "Connect"}
                <Link2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={mock} disabled={!bridgeReady}>
                Demo without Flutter
              </Button>
            </div>
            <div className="mt-4 min-h-[3rem] text-sm">
              {error ? (
                <p className="rounded-md border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-rose-200">
                  {error}
                </p>
              ) : (
                <p className="text-[var(--ink-muted)]">{statusMessage}</p>
              )}
            </div>
          </motion.div>
        </motion.section>
      </main>
    </div>
  );
}
