"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SavedSession } from "@/lib/session-history";
import { compareSessions, formatDelta } from "@/lib/session-history";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = (await res.json()) as { sessions: SavedSession[] };
      setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
    );
  };

  const remove = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSelected((prev) => prev.filter((x) => x !== id));
    await load();
  };

  const picked = sessions.filter((s) => selected.includes(s.id));
  const comparison = picked.length === 2 ? compareSessions(picked[0], picked[1]) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          History
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Saved sessions on the bridge host — select two to compare (lower is better)
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">
          No saved sessions yet — use Save session on the Report page.
        </p>
      ) : (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <ul className="space-y-2 text-sm">
            {sessions.map((s) => {
              const active = selected.includes(s.id);
              return (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    active ? "border-teal-400/40 bg-teal-500/10" : "border-white/8 bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="flex-1 text-left text-[var(--ink-muted)]"
                  >
                    <span className="text-[var(--ink)]">
                      {s.label ?? new Date(s.savedAt).toLocaleString()}
                    </span>
                    <span className="ml-2 text-xs text-[var(--ink-faint)]">
                      {s.mode ?? "—"} · problems {s.stats.problemCount} · p95 build{" "}
                      {s.stats.p95BuildMs} ms · jank {(s.stats.jankRatio * 100).toFixed(0)}%
                    </span>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(s.id)}>
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {comparison.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Compare
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                <tr>
                  <th className="pb-2 font-normal">Metric</th>
                  <th className="pb-2 font-normal">Before</th>
                  <th className="pb-2 font-normal">After</th>
                  <th className="pb-2 font-normal">Delta</th>
                </tr>
              </thead>
              <tbody className="text-[var(--ink-muted)]">
                {comparison.map((row) => (
                  <tr key={row.key} className="border-t border-white/5">
                    <td className="py-2 text-[var(--ink)]">{row.label}</td>
                    <td className="py-2">{row.before.toFixed(2)}</td>
                    <td className="py-2">{row.after.toFixed(2)}</td>
                    <td className={`py-2 ${row.improved ? "text-teal-200" : "text-rose-200"}`}>
                      {formatDelta(row.key, row.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
