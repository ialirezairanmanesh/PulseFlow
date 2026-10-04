"use client";

import { LabControls } from "@/components/lab-controls";
import { usePulse } from "@/lib/pulse-store";

export default function ToolsPage() {
  const {
    extension,
    connected,
    stress,
    refreshExtensions,
    scenarios,
    scenarioRunning,
    scenarioMessage,
    baselines,
    listScenarios,
    runScenario,
    stopScenario,
    captureBaseline,
    clearBaselines,
  } = usePulse();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)]">
          Lab
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Stress controls, repeatable scenarios, and before/after baselines
        </p>
      </div>
      <LabControls
        extension={extension}
        disabled={!connected}
        scenarios={scenarios}
        scenarioRunning={scenarioRunning}
        scenarioMessage={scenarioMessage}
        baselines={baselines}
        onStress={stress}
        onRefresh={refreshExtensions}
        onListScenarios={listScenarios}
        onRunScenario={runScenario}
        onStopScenario={stopScenario}
        onCaptureBaseline={captureBaseline}
        onClearBaselines={clearBaselines}
      />
    </div>
  );
}
