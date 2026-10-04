# pulseflow_flutter

App-side probes for [PulseFlow](../docs/pulseflow). Registers `ext.pulseflow.*` service
extensions and exposes accurate runtime signals to the dashboard.

## What it adds over the old single-file stub

- **Accurate frame timings** via `SchedulerBinding.addTimingsCallback` — real build/raster/vsync
  durations, not estimates.
- **Refresh-rate-aware budget** from the active display (`1000 / refreshRate`), so 90/120 Hz
  devices are judged correctly.
- **Widget source locations** (`file:line`) for heavy rebuilds, resolved through the widget
  inspector (debug/profile).
- **HTTP capture** via a delegating `HttpOverrides` — covers `package:http` and Dio's IO adapter
  without the VM Service HTTP profiler.
- **Leak signals** from `FlutterMemoryAllocations` (outstanding created-not-disposed objects).

## Usage

```yaml
dependencies:
  pulseflow_flutter:
    path: ../pulseflow_flutter
```

```dart
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  registerPulseFlow(appPackage: 'my_app');
  runApp(const MyApp());
}
```

Options: `appPackage`, `captureFrames`, `captureNetwork`, `trackLeaks`.

## RPCs

| RPC | Purpose |
| --- | --- |
| `getFrameStats` | Accurate frame timings + refresh rate/budget |
| `getNetworkLog` | Drain captured HTTP requests |
| `getLeakReport` | Outstanding objects by class |
| `startWidgetProbe` / `stopWidgetProbe` / `resetWidgetProbe` / `setWidgetProbeFrozen` / `getHotWidgets` | Rebuild probe with source locations |
| `injectInvoices` / `spikeCpu` / `allocateMemory` | Stress actions |
| `listScenarios` / `runScenario` / `stopScenario` | Repeatable lab scenarios |

Notes: the widget probe, source locations, leak signals, and scenarios require debug/profile
builds. HTTP capture works in all modes but adds a thin wrapper around `HttpClient`.

## Layout

```
lib/
  pulseflow_flutter.dart              public API (registerPulseFlow)
  src/rpc/service_extension_registry.dart
  src/probes/frame_probe.dart
  src/probes/rebuild_probe.dart
  src/probes/widget_source.dart
  src/probes/network_probe.dart
  src/probes/leak_probe.dart
  src/device/display_info.dart
  src/scenarios/{builtin_scenarios,scenario_runner}.dart
  src/state/stress_state.dart
example/                              minimal app
test/                                 unit tests
```

## Test

```bash
flutter test
flutter analyze
```
