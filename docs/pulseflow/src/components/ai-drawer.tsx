"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildSectionContext,
  SECTION_QUICK_PROMPTS,
  SECTION_TITLES,
  sectionFromPath,
  type ChatMessage,
} from "@/lib/ai-context";
import { getAiSettings, streamAiChat, type AiSettingsView } from "@/lib/ai-client";
import { buildProblems } from "@/lib/problems";
import { usePulse } from "@/lib/pulse-store";

export function AiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const section = sectionFromPath(pathname);

  const {
    mode,
    points,
    hot,
    hotAvailable,
    gcEvents,
    cpuProfile,
    memoryDiff,
    network,
    scenarioResult,
    scenarioRunning,
    rebuildCauses,
    appErrors,
    buildInfo,
    leaks,
    images,
    deviceContext,
    stalls,
  } = usePulse();

  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [turns, setTurns] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getAiSettings()
      .then((value) => {
        if (active) {
          setSettings(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [open]);

  const problems = useMemo(
    () =>
      buildProblems({
        hot,
        hotAvailable,
        latest: points.at(-1),
        gcEvents,
        cpuProfile,
        memoryDiff,
        network,
        points,
        scenarioResult,
        scenarioRunning,
        rebuildCauses,
        errors: appErrors,
        stalls,
      }),
    [
      hot,
      hotAvailable,
      points,
      gcEvents,
      cpuProfile,
      memoryDiff,
      network,
      scenarioResult,
      scenarioRunning,
      rebuildCauses,
      appErrors,
      stalls,
    ],
  );

  const buildContext = useCallback(
    () =>
      buildSectionContext(section, {
        mode,
        points,
        problems,
        budgetMs: points.at(-1)?.buildBudgetMs,
        hot,
        cpuProfile,
        memoryDiff,
        leaks,
        images: images
          ? { available: images.available, cache: images.cache, oversized: images.oversized }
          : null,
        network,
        errors: appErrors,
        buildInfo,
        deviceContext,
        stalls,
      }),
    [
      section,
      mode,
      points,
      problems,
      hot,
      cpuProfile,
      memoryDiff,
      leaks,
      images,
      network,
      appErrors,
      buildInfo,
      deviceContext,
      stalls,
    ],
  );

  const send = useCallback(
    async (question?: string) => {
      if (streaming) return;
      setError(null);
      const history = turns;
      const context = buildContext();
      const asked = question?.trim() || `Analyze the ${SECTION_TITLES[section]} view.`;

      setTurns((prev) => [
        ...prev,
        { role: "user", content: asked },
        { role: "assistant", content: "" },
      ]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAiChat({
          section,
          context,
          question,
          history,
          signal: controller.signal,
          onDelta: (chunk) =>
            setTurns((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + chunk };
              }
              return copy;
            }),
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, turns, buildContext, section],
  );

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const copyTranscript = async () => {
    const text = turns
      .map((t) => `${t.role === "user" ? "You" : "AI"}: ${t.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — ignore
    }
  };

  const configured = Boolean(settings?.hasKey);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close AI panel"
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
          onClick={onClose}
        />
      )}
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#06121b]/95 backdrop-blur-md transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <div className="font-[family-name:var(--font-display)] text-sm tracking-tight text-[var(--ink)]">
                Ask AI
              </div>
              <div className="text-[11px] text-[var(--ink-faint)]">
                reviewing “{SECTION_TITLES[section]}”
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {turns.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void copyTranscript()}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {settings === null && !error ? (
          <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">Loading…</p>
        ) : !configured ? (
          <div className="space-y-3 px-4 py-6 text-sm">
            <p className="text-[var(--ink)]">
              Add an API key to let AI review this view and suggest fixes in plain language.
            </p>
            <Button size="sm" asChild>
              <Link href="/ai">Open AI settings</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {turns.length === 0 && (
                <div className="space-y-3 text-sm text-[var(--ink-muted)]">
                  <p>
                    Ask about “{SECTION_TITLES[section]}”. The model gets this view’s data plus widget
                    and route evidence when available.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" onClick={() => void send()}>
                      <Sparkles className="h-3.5 w-3.5" />
                      Analyze this view
                    </Button>
                  </div>
                </div>
              )}

              {turns.map((turn, index) =>
                turn.role === "assistant" ? (
                  <div
                    key={index}
                    dir="auto"
                    className="whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-relaxed text-[var(--ink)]"
                  >
                    {turn.content || (streaming && index === turns.length - 1 ? "…" : "")}
                  </div>
                ) : (
                  <div
                    key={index}
                    dir="auto"
                    className="whitespace-pre-wrap break-words rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-2 text-sm text-[var(--ink)]"
                  >
                    {turn.content}
                  </div>
                ),
              )}

              {error && (
                <p className="rounded-md border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {error}
                </p>
              )}
            </div>

            {turns.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-4 pt-3">
                {SECTION_QUICK_PROMPTS[section].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={streaming}
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    {prompt.replace(/\.$/, "")}
                  </button>
                ))}
              </div>
            )}

            <form
              className="flex items-end gap-2 border-t border-white/10 px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                const value = input.trim();
                if (!value || streaming) return;
                setInput("");
                void send(value);
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={2}
                dir="auto"
                placeholder="Ask a follow-up…"
                className="min-h-[44px] flex-1 resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]/50"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const value = input.trim();
                    if (!value || streaming) return;
                    setInput("");
                    void send(value);
                  }
                }}
              />
              {streaming ? (
                <Button type="button" size="sm" variant="danger" onClick={stop}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!input.trim()}>
                  Send
                </Button>
              )}
            </form>
          </>
        )}
      </aside>
    </>
  );
}
