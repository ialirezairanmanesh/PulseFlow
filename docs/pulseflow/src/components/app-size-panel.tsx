"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  analyzeAppSize,
  diffAppSize,
  type SizeAnalysis,
  type SizeEntry,
  type SizeKind,
} from "@/lib/app-size";
import { formatBytes, cn } from "@/lib/utils";

type Tab = "overview" | "packages" | "assets" | "diff";

const KIND_LABEL: Record<SizeKind, string> = {
  dart_package: "Dart pkg",
  asset: "Asset",
  native: "Native",
  flutter: "Flutter",
  other: "Other",
};

function KindBadge({ kind }: { kind: SizeKind }) {
  return (
    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--ink-faint)]">
      {KIND_LABEL[kind]}
    </span>
  );
}

function SizeBar({ share }: { share: number }) {
  const w = Math.min(100, Math.max(0.5, share));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className="h-full rounded-full bg-teal-400/70"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function EntryTable({ rows, empty }: { rows: SizeEntry[]; empty: string }) {
  if (!rows.length) {
    return <p className="text-sm text-[var(--ink-faint)]">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium text-right">Size</th>
            <th className="px-3 py-2 font-medium w-[40%]">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-2 font-mono text-xs text-[var(--ink)]">
                <span className="line-clamp-1" title={r.path}>
                  {r.name}
                </span>
              </td>
              <td className="px-3 py-2">
                <KindBadge kind={r.kind} />
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                {formatBytes(r.bytes)}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <SizeBar share={r.share} />
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] text-[var(--ink-muted)]">
                    {r.share.toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

export function AppSizePanel() {
  const [analysis, setAnalysis] = useState<SizeAnalysis | null>(null);
  const [before, setBefore] = useState<SizeAnalysis | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const inputRef = useRef<HTMLInputElement>(null);
  const beforeRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File | undefined, as: "main" | "before") => {
    if (!file) return;
    setError(null);
    try {
      const raw = await readJsonFile(file);
      const next = analyzeAppSize(raw);
      if (as === "before") {
        setBefore(next);
        setTab("diff");
      } else {
        setAnalysis(next);
        setFileName(file.name);
        setTab("overview");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse size JSON");
    }
  }, []);

  const diff = useMemo(
    () => (analysis && before ? diffAppSize(before, analysis) : null),
    [analysis, before],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
            App size
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--ink-muted)]">
            Import a Flutter{" "}
            <code className="text-[var(--ink)]">*-code-size-analysis_*.json</code> from{" "}
            <code className="text-[var(--ink)]">flutter build … --analyze-size</code> to see
            what dominates the binary.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0], "main")}
          />
          <input
            ref={beforeRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0], "before")}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" />
            Import JSON
          </Button>
          {analysis && (
            <>
              <Button size="sm" variant="secondary" onClick={() => beforeRef.current?.click()}>
                Diff vs before…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAnalysis(null);
                  setBefore(null);
                  setFileName(null);
                  setError(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      )}

      {!analysis && (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center">
          <p className="text-sm text-[var(--ink-muted)]">No size analysis loaded yet.</p>
          <pre className="mx-auto mt-4 max-w-xl overflow-x-auto rounded-lg bg-black/30 px-3 py-2 text-left text-[11px] text-[var(--ink-faint)]">
{`flutter build apk --analyze-size --target-platform=android-arm64
# then import build/*-code-size-analysis_*.json`}
          </pre>
          <Button className="mt-5" onClick={() => inputRef.current?.click()}>
            <FileUp className="h-4 w-4" />
            Choose JSON file
          </Button>
        </div>
      )}

      {analysis && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="live">{analysis.type ?? "size"}</Badge>
            <span className="text-sm text-[var(--ink)]">{analysis.rootName}</span>
            <span className="font-mono text-sm text-teal-200">
              {formatBytes(analysis.totalBytes)}
            </span>
            {fileName && (
              <span className="text-xs text-[var(--ink-faint)] truncate max-w-[14rem]">
                {fileName}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                ["overview", "Overview"],
                ["packages", "Packages"],
                ["assets", "Assets"],
                ["diff", "Diff"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition",
                  tab === id
                    ? "bg-teal-500/15 text-teal-100"
                    : "text-[var(--ink-muted)] hover:bg-white/5",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="space-y-4">
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  Top-level buckets
                </h3>
                <EntryTable rows={analysis.categories} empty="No categories in this file." />
              </section>
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  Largest contributors
                </h3>
                <EntryTable rows={analysis.top} empty="No large nodes found." />
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  How to shrink
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-muted)]">
                  {analysis.tips.map((t) => (
                    <li key={t}>· {t}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {tab === "packages" && (
            <EntryTable
              rows={analysis.packages.slice(0, 40)}
              empty="No package: entries found — ensure this is a full --analyze-size JSON (AOT breakdown included)."
            />
          )}

          {tab === "assets" && (
            <EntryTable
              rows={analysis.assets.slice(0, 40)}
              empty="No asset leaves found under assets/ / flutter_assets."
            />
          )}

          {tab === "diff" && (
            <div className="space-y-4">
              {!before && (
                <p className="text-sm text-[var(--ink-muted)]">
                  Import a previous analysis with <strong>Diff vs before…</strong> to see what grew
                  or shrank.
                </p>
              )}
              {diff && (
                <>
                  <p className="text-sm text-[var(--ink)]">
                    Total {formatBytes(diff.beforeTotal)} → {formatBytes(diff.afterTotal)}{" "}
                    <span
                      className={
                        diff.deltaBytes <= 0 ? "text-teal-200" : "text-rose-200"
                      }
                    >
                      ({diff.deltaBytes >= 0 ? "+" : ""}
                      {formatBytes(Math.abs(diff.deltaBytes))}
                      {diff.deltaBytes < 0 ? " saved" : ""})
                    </span>
                  </p>
                  <section>
                    <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-rose-200/80">
                      Grew
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-sm">
                        <tbody>
                          {diff.grew.map((r) => (
                            <tr key={`g-${r.name}`} className="border-b border-white/5">
                              <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs text-rose-200">
                                +{formatBytes(r.deltaBytes)}
                              </td>
                            </tr>
                          ))}
                          {!diff.grew.length && (
                            <tr>
                              <td className="px-3 py-2 text-[var(--ink-faint)]">Nothing grew</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-teal-200/80">
                      Shrank
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-sm">
                        <tbody>
                          {diff.shrank.map((r) => (
                            <tr key={`s-${r.name}`} className="border-b border-white/5">
                              <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs text-teal-200">
                                {formatBytes(r.deltaBytes)}
                              </td>
                            </tr>
                          ))}
                          {!diff.shrank.length && (
                            <tr>
                              <td className="px-3 py-2 text-[var(--ink-faint)]">Nothing shrank</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
