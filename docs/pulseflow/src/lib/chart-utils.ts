import type { MetricPoint } from "@/lib/types";
import { formatMs } from "@/lib/utils";

export const FRAME_BUDGET = 16.67;

export const tooltipStyle = {
  background: "rgba(8, 18, 28, 0.92)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 12,
  color: "#e8f4f2",
};

export function normalizePoint(p: MetricPoint) {
  return {
    ...p,
    framePressure: p.framePressure ?? p.cpu ?? 0,
    buildMs: p.buildMs ?? 0,
    rasterMs: p.rasterMs ?? 0,
    vsyncMs: p.vsyncMs ?? 0,
  };
}

export function healthFromPoint(latest?: MetricPoint, jankCount = 0) {
  if (!latest) {
    return {
      label: "No data",
      tone: "idle" as const,
      reason: "Connect or try Demo mode to see frame health here",
    };
  }
  const build = latest.buildMs ?? 0;
  const raster = latest.rasterMs ?? 0;
  const frame = latest.frameMs ?? 0;
  if (frame > FRAME_BUDGET * 1.6 || jankCount >= 12) {
    return {
      label: "Very heavy",
      tone: "bad" as const,
      reason:
        build >= raster
          ? `Build is ~${formatMs(build)} — widgets/layout are rebuilding heavily`
          : `Raster is ~${formatMs(raster)} — paint/shadows/opacity are expensive`,
    };
  }
  if (frame > FRAME_BUDGET || jankCount >= 4) {
    return {
      label: "Heavy",
      tone: "warn" as const,
      reason: `Frame ${formatMs(frame)} is over the 16ms budget (${jankCount} jank samples)`,
    };
  }
  return {
    label: "Smooth",
    tone: "good" as const,
    reason: `Frame ${formatMs(frame)} under 16ms budget · Build ${formatMs(build)} · Raster ${formatMs(raster)}`,
  };
}

export function statusVariant(
  status: string,
  mode?: "live" | "mock",
) {
  if (status === "error") return "error" as const;
  if (status === "connected" && mode === "mock") return "mock" as const;
  if (status === "connected") return "live" as const;
  return "idle" as const;
}
