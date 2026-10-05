"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DebugOptionId, DebugOptionState } from "@/lib/types";
import { Activity, Gauge, ImageIcon, Layers, Paintbrush, Rainbow, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const OPTION_META: Record<
  DebugOptionId,
  { label: string; description: string; Icon: LucideIcon }
> = {
  performanceOverlay: {
    label: "Performance Overlay",
    description: "UI / raster frame graphs on the device",
    Icon: Gauge,
  },
  slowAnimations: {
    label: "Slow Animations",
    description: "5× time dilation for easier inspection",
    Icon: Timer,
  },
  debugPaint: {
    label: "Show Guidelines",
    description: "Paint render box bounds and padding",
    Icon: Paintbrush,
  },
  debugPaintBaselines: {
    label: "Show Baselines",
    description: "Draw alphabetic / ideographic baselines",
    Icon: Layers,
  },
  repaintRainbow: {
    label: "Highlight Repaints",
    description: "Rainbow borders when layers repaint",
    Icon: Rainbow,
  },
  invertOversizedImages: {
    label: "Highlight Oversized Images",
    description: "Invert images decoded larger than needed",
    Icon: ImageIcon,
  },
  debugBanner: {
    label: "Show Debug Banner",
    description: "DEBUG ribbon in the corner",
    Icon: Activity,
  },
};

const ORDER: DebugOptionId[] = [
  "performanceOverlay",
  "slowAnimations",
  "debugPaint",
  "debugPaintBaselines",
  "repaintRainbow",
  "invertOversizedImages",
  "debugBanner",
];

export function DebugOptionsPanel({
  options,
  disabled,
  message,
  onToggle,
  onRefresh,
}: {
  options: DebugOptionState[];
  disabled: boolean;
  message?: string;
  onToggle: (id: DebugOptionId, enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const anyAvailable = options.some((o) => o.available);

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--ink)]">
            Flutter debug overlays
          </h3>
          <p className="text-sm text-[var(--ink-muted)]">
            Same toggles as Flutter DevTools — draw overlays on the running app
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={anyAvailable ? "live" : "idle"}>
            {anyAvailable ? "flutter extensions" : "unavailable"}
          </Badge>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      {!disabled && !anyAvailable && options.length > 0 && (
        <p className="mb-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Flutter debug service extensions are not registered. Run the app in{" "}
          <span className="text-[var(--ink)]">debug</span> (or profile for Performance Overlay)
          and reconnect.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {ORDER.map((id) => {
          const meta = OPTION_META[id];
          const state = byId.get(id);
          const available = state?.available ?? false;
          const enabled = state?.enabled ?? false;
          const Icon = meta.Icon;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled || !available}
              onClick={() => onToggle(id, !enabled)}
              className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                enabled
                  ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--ink)]"
                  : "border-white/10 bg-black/30 text-[var(--ink-muted)] hover:bg-white/5"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--ink)]">{meta.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                  {meta.description}
                </span>
              </span>
              <span
                className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  enabled
                    ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                    : "bg-white/5 text-[var(--ink-faint)]"
                }`}
              >
                {enabled ? "on" : "off"}
              </span>
            </button>
          );
        })}
      </div>

      {message && <p className="mt-3 text-sm text-[var(--ink-muted)]">{message}</p>}
    </section>
  );
}
