## 0.2.1

- README: drop insecure `http://` markdown links so pub points stay at 160.

## 0.2.0

- **Device context:** `ext.pulseflow.getDeviceContext` reports platform, build
  mode, locale, text scale, display metrics, and optional app enricher extras.
- **Custom scenarios:** `registerPulseFlowScenario()` merges app scenarios into
  `listScenarios` / `runScenario` (built-in ids cannot be overridden).
- **UI stall probe:** `ext.pulseflow.getStallReport` detects main-isolate
  freezes above a configurable threshold (default 250 ms).
- **Network:** `networkBurst` fires real HTTP GETs by default (or an
  `onNetworkBurst` hook); captured URIs redact auth/token query params.
- `registerPulseFlow` gains `trackStalls`, `stallThreshold`, and
  `deviceEnricher` options.

## 0.1.0

- Initial release of the PulseFlow app-side package.
- Accurate frame timings via `SchedulerBinding.addTimingsCallback`, with
  refresh-rate-aware budgets from the active display.
- Rebuild hotspot probe with stable widget ids, route labels, and source
  locations (`file:line`) through the widget inspector.
- HTTP capture via a delegating `HttpOverrides`.
- Leak signals from `FlutterMemoryAllocations` (created-not-disposed objects).
- Runtime error / overflow signatures, image cache health, and oversized decode
  tracking.
- Built-in lab scenarios and stress RPCs (`scrollStorm`, `routeThrash`,
  `listFlood`, `animationFlood`, `retainMemory`, `networkBurst`).
- Public entry point: `registerPulseFlow()` registering `ext.pulseflow.*`
  service extensions for the PulseFlow dashboard.
