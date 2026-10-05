"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearAiSettings,
  getAiSettings,
  saveAiSettings,
  testAi,
  type AiSettingsView,
  type SaveAiPatch,
} from "@/lib/ai-client";
import type { AiLanguage, AiProvider } from "@/lib/ai-providers";

export default function AiSettingsPage() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState<AiLanguage>("fa");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((value: AiSettingsView) => {
    setView(value);
    setProvider(value.provider);
    setModel(value.model);
    setBaseUrl(value.baseUrl);
    setLanguage(value.language);
    setApiKey("");
  }, []);

  useEffect(() => {
    getAiSettings()
      .then(apply)
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err)));
  }, [apply]);

  const onProviderChange = (id: AiProvider) => {
    setProvider(id);
    const meta = view?.providers.find((p) => p.id === id);
    if (meta) {
      setModel(meta.defaultModel);
      setBaseUrl(meta.defaultBaseUrl);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const patch: SaveAiPatch = { provider, model, baseUrl, language };
      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      apply(await saveAiSettings(patch));
      setMessage("Saved. The key stays on this host and is never sent to the browser again.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await testAi();
      setMessage(
        result.ok
          ? `Connection OK${result.sample ? ` — model replied: ${result.sample}` : ""}`
          : `Connection failed: ${result.error ?? "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      apply(await clearAiSettings());
      setMessage("Cleared.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          AI assistant
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Bring your own key. The drawer reviews any section and explains problems in plain language.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Provider
          </h3>
          {view && (
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                view.hasKey
                  ? "bg-emerald-400/15 text-emerald-300"
                  : "bg-white/10 text-[var(--ink-faint)]"
              }`}
            >
              {view.hasKey ? "key saved" : "no key"}
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ai-provider">Provider</Label>
            <select
              id="ai-provider"
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as AiProvider)}
              className="flex h-11 w-full rounded-md border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/70"
            >
              {view?.providers.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#06121b]">
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={view?.providers.find((p) => p.id === provider)?.defaultModel}
            />
          </div>

          {provider === "openai" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <p className="text-xs text-[var(--ink-faint)]">
                Any OpenAI-compatible endpoint: OpenAI, DeepSeek, OpenRouter, Moonshot, a local
                Ollama/LM Studio server, …
              </p>
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-key">API key</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={view?.hasKey ? "•••••••• (leave blank to keep)" : "paste your key"}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Answer language</Label>
            <div className="flex gap-2">
              {(
                [
                  ["fa", "فارسی"],
                  ["en", "English"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLanguage(id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    language === id
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--ink)]"
                      : "border-white/10 bg-black/30 text-[var(--ink-muted)] hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void test()}>
            Test connection
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
            Clear
          </Button>
        </div>

        {message && <p className="text-sm text-[var(--ink-muted)]">{message}</p>}
      </section>

      <p className="text-xs text-[var(--ink-faint)]">
        Stored server-side in <code>.data/ai-settings.json</code> on this host (git-ignored). The key is
        used only by the local proxy route and is never sent to your browser.
      </p>
    </div>
  );
}
