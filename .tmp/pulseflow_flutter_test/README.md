# pulseflow_flutter

App-side probes for **[PulseFlow](https://github.com/ialirezairanmanesh/PulseFlow)** — a problems-first Flutter performance lab.

This package runs **inside your Flutter app**, registers `ext.pulseflow.*` service
extensions, and feeds the PulseFlow dashboard with accurate frame timings, rebuild
hotspots, HTTP traffic, leaks, stalls, device context, and lab scenarios.

Without this package the dashboard can still show Build/Raster/memory/CPU via the VM
Service. With it you unlock Widgets, richer Problems tips, Network capture, Leaks,
Stalls, Scenarios, device context, and accurate engine frame timings.

> Prefer working from your coding agent (Cursor, Claude Code, Command Code)? PulseFlow
> ships an MCP server so the agent can read the session directly — see
> [Use it from your coding agent (MCP)](#use-it-from-your-coding-agent-mcp).

---

## How PulseFlow fits together

```
Your Flutter app ── registerPulseFlow() ──► ext.pulseflow.* (VM Service)
                                                    ▲
PulseFlow dashboard (browser) ◄── WebSocket ──► Dart bridge
```

| Piece | Role |
| --- | --- |
| **This package** (`pulseflow_flutter`) | In-app probes + service extensions |
| **Dart bridge** | Proxies the browser to the Dart VM Service (browsers cannot open arbitrary `ws://` targets reliably) |
| **Dashboard** | Problems-first UI: ranked issues, frames, CPU, memory, network, report |
| **MCP server** (optional) | Lets your coding agent read the live session directly (Cursor / Claude / Command Code) |

You need the first three for the full experience; the MCP server is optional and
lives in the PulseFlow repo.

---

## Quick start (end-to-end)

### 1. Add the package

```yaml
dependencies:
  pulseflow_flutter: ^0.2.0
```

### 2. Register once in `main()`

```dart
import 'package:flutter/material.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  registerPulseFlow(appPackage: 'my_app'); // use your pubspec `name`
  runApp(const MyApp());
}
```

Call **before** `runApp`. Use your app’s package `name` from `pubspec.yaml` as
`appPackage` so source locations prefer your code over `package:flutter`.

**Hot-restart** (or full restart) after adding the package so extensions are registered.

### 3. Run the app in the right mode

```bash
flutter run            # debug — required for widget rebuild / source locations
# or
flutter run --profile  # preferred for CPU and realistic frame timings
```

See [Build-mode matrix](#build-mode-matrix) below — rebuild tracking is **debug-only**.

### 4. Start the PulseFlow dashboard + bridge

```bash
git clone https://github.com/ialirezairanmanesh/PulseFlow.git
cd PulseFlow
make run
# or: ./run.sh
```

- Dashboard: `http://127.0.0.1:3846`
- Bridge: `http://127.0.0.1:3847`

Requires **Node 18+** (22 recommended) and a Dart SDK for the bridge.

### 5. Connect

1. Open the dashboard.
2. Click **Find running apps** / **Scan** (also runs when the bridge connects).
3. Pick your app → **Connect**.
4. You land on **Problems**.

If discovery misses the app, paste the VM Service URL from `flutter run`, e.g.
`ws://127.0.0.1:xxxxx/AUTH=/ws`.

Use **Try demo mode** to explore the UI without a device.

---

## What you get in the dashboard

| Page | What it shows |
| --- | --- |
| **Problems** | Health verdict, “Fix this next”, ranked issues |
| **Widgets** | Rebuild hotspots (debug; route / app-only / during-jank filters) |
| **Frames** | Build / raster charts, markers, Perfetto export |
| **CPU** | Record 3/5/10s, top functions, flamegraph |
| **Memory** | Heap, snapshots / diff, leak signals |
| **Network** | HTTP list, waterfall (app `HttpOverrides` + VM HTTP profile) |
| **Logs** | Runtime / framework logs via the bridge |
| **Tools** | Debug overlays, stress actions, scenarios, baselines |
| **Report / History** | Session export, before/after verdict |
| **AI** | Optional review with *your* provider API key |

The bridge WebSocket is shared across routes — changing tabs does not reconnect.

---

## What this package adds

- **Accurate frame timings** via `SchedulerBinding.addTimingsCallback`
- **Refresh-rate-aware budget** from the active display (`1000 / refreshRate`)
- **Widget source locations** (`file:line`) via the widget inspector (**debug**)
- **HTTP capture** via a delegating `HttpOverrides` (`package:http`, Dio IO adapter); sensitive query params and URI user-info are redacted
- **Leak signals** from `FlutterMemoryAllocations` (when Flutter enables allocation tracking — typically debug)
- **Device context** (`getDeviceContext`: platform, display, locale, text scale; optional enricher extras)
- **UI stall detection** for main-isolate freezes (default threshold 250 ms)
- **Custom lab scenarios** via `registerPulseFlowScenario`

---

## `registerPulseFlow` options

```dart
registerPulseFlow(
  appPackage: 'my_app',
  captureFrames: true,   // engine frame timings (recommended)
  captureNetwork: true,  // HttpOverrides capture
  trackLeaks: true,      // FlutterMemoryAllocations when enabled
  trackErrors: true,     // overflow / assertion / exception signatures
  trackImages: true,     // image cache + oversized decode hints
  trackStalls: true,     // main-isolate freeze detection
  stallThreshold: const Duration(milliseconds: 250),
  deviceEnricher: () async => <String, Object?>{
    'appVersion': '1.2.3',
    // battery / connectivity / etc. — optional, no forced plugins
  },
);
```

| Flag | Default | Notes |
| --- | --- | --- |
| `appPackage` | `null` | Restricts widget source URIs to this package when set |
| `captureFrames` | `true` | `SchedulerBinding.addTimingsCallback` |
| `captureNetwork` | `true` | Thin `HttpClient` wrapper; chains to any previous `HttpOverrides` |
| `trackLeaks` | `true` | No-op unless `kFlutterMemoryAllocationsEnabled` |
| `trackErrors` | `true` | Debug/profile |
| `trackImages` | `true` | Debug/profile |
| `trackStalls` | `true` | Debug/profile; threshold via `stallThreshold` |
| `deviceEnricher` | `null` | Merged into `getDeviceContext` under `extras` |

Idempotent: calling again is safe; extensions register only once.
Check `isPulseFlowRegistered` if needed.

### Device enricher only

```dart
registerPulseFlow(
  appPackage: 'my_app',
  deviceEnricher: () async => <String, Object?>{
    'appVersion': '1.2.3',
    'batteryPercent': 72,
  },
);
```

---

## Route labels (better Widgets / Problems)

Rebuilds group by route. Labels resolve in this order:

1. `RouteSettings.name` (named routes)
2. `Router` URI (`MaterialApp.router` / go_router)
3. Nearest `*Page` / `*Screen` ancestor widget

Prefer naming routes:

```dart
Navigator.pushNamed(context, '/invoice');
// or
MaterialPageRoute(
  settings: const RouteSettings(name: 'invoice'),
  builder: (_) => const InvoicePage(),
);
```

---

## Lab scenarios & stress

### Built-in scenarios (Tools page)

| Id | What it does |
| --- | --- |
| `scrollStorm` | Rapid scroll jumps on primary scrollables |
| `routeThrash` | Push/pop lightweight routes |
| `listFlood` | Burst-append items into `PulseFlowStressState.invoices` |
| `animationFlood` | Spawn repeating animation controllers |
| `retainMemory` | Allocate and retain byte buffers |
| `networkBurst` | Parallel HTTP GETs by default, or your `onNetworkBurst` hook |

Wire stress state into your UI when useful:

```dart
final stress = PulseFlowStressState.instance;

// Listen / rebuild from stress.invoices during listFlood
stress.onNetworkBurst = (params) async {
  // optional app-specific burst
};
```

### Custom scenarios

```dart
registerPulseFlowScenario(
  const ScenarioInfo(
    id: 'openInvoice',
    label: 'Open invoice',
    description: 'Navigate to invoice detail and scroll',
  ),
  (params, {required shouldStop}) async {
    // Drive your app; check shouldStop() between steps.
  },
);
```

Do not reuse built-in ids (`scrollStorm`, `routeThrash`, …).

### Stress RPCs (from the dashboard)

- `spikeCpu` — busy-loop (`millis`)
- `allocateMemory` — retain buffers (`megabytes`)

Scenarios are blocked in **release**. Stress RPCs are still registered in all modes;
prefer debug/profile for lab work.

---

## Service extensions reference

All names are under `ext.pulseflow.*`. The dashboard / bridge call these for you.

| Extension | Purpose |
| --- | --- |
| `getFrameStats` | Accurate build/raster/vsync + refresh rate / budget + `buildMode` / `probes` |
| `getDeviceContext` | Platform, locale, display, optional `extras` |
| `getStallReport` / `resetStallProbe` | Main-isolate freeze events |
| `startWidgetProbe` / `stopWidgetProbe` / `resetWidgetProbe` / `setWidgetProbeFrozen` / `getHotWidgets` | Rebuild probe (10s rolling window; **debug** data) |
| `getRebuildCauses` | Rebuild roots + attributed descendants |
| `getNetworkLog` | Drain captured HTTP requests (redacted URIs) |
| `getLeakReport` | Outstanding objects by class |
| `getErrors` | Overflow / assertion / exception signatures |
| `getImageStats` | Image cache + oversized decodes |
| `spikeCpu` / `allocateMemory` | Stress |
| `listScenarios` / `runScenario` / `stopScenario` | Built-in + custom lab scenarios |

---

## Build-mode matrix

Aligned with `probeAvailability()` in this package:

| Capability | Debug | Profile | Release |
| --- | --- | --- | --- |
| Frame timings | yes | yes | yes (if `captureFrames`) |
| Device context | yes | yes | yes |
| HTTP capture | yes | yes | yes (wrapper; prefer not for production) |
| Errors / images / stalls | yes | yes | no |
| Widget rebuild probe / source locations | **yes** | no* | no |
| Leak signals | when allocation tracking is on (usually debug) | rare | no |
| Scenarios | yes | yes | no |
| VM Service CPU / memory / timeline (dashboard) | yes | preferred for CPU | no VM Service |

\*Rebuild sampling uses `debugOnRebuildDirtyWidget`, which only fires in **debug**.
Profile is still the right mode for CPU flamegraphs and more realistic frames.

---

## Typical workflow

1. `registerPulseFlow` + hot-restart.
2. Use **debug** for Widgets / source locations; **profile** for CPU and frame realism (you can switch modes between passes).
3. `make run` in the PulseFlow repo.
4. Connect → exercise the slow screen → read **Problems**.
5. Drill into Widgets / Frames / Network as needed.
6. Run a scenario on **Tools** to reproduce jank.
7. Fix → Record again → compare on **Report** / **History**.

Optional CI: the PulseFlow repo ships `pulseflow_check` (budget gate on P95 build / jank).

---

## Use it from your coding agent (MCP)

PulseFlow ships a local [Model Context Protocol](https://modelcontextprotocol.io)
server, so an agent that speaks MCP — **Cursor**, **Claude Code**, **Command Code** —
can read the live session for you: rank the problems, explain each one, and propose
fixes, using the same ranking as the **Problems** page. It proxies the same bridge,
so you run nothing extra beyond PulseFlow itself.

You still need the **PulseFlow bridge** running. Clone the repo and start it (the first
run installs the Node and Dart dependencies):

```bash
git clone https://github.com/ialirezairanmanesh/PulseFlow.git
cd PulseFlow
make run          # Dart bridge on :3847 (+ dashboard on :3846)
```

Only the **bridge** matters for the MCP; the dashboard UI is optional and you can ignore
its browser tab. (Later, `make bridge` starts just the bridge once the dependencies are
installed.)

### Register the MCP server

The server is published on npm as **`pulseflow-mcp`**, so there is nothing to install —
your MCP client runs it with `npx`.

**Cursor** — `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` to use it everywhere:

```json
{
  "mcpServers": {
    "pulseflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "pulseflow-mcp"]
    }
  }
}
```

**Command Code** — `cmd mcp add pulseflow -- npx -y pulseflow-mcp`.
**Claude Code / other MCP clients** — the same `mcpServers` entry. Restart the client (or
toggle the server) after adding it.

Developing from a checkout instead? Point the command at `<repo>/docs/pulseflow/mcp/run.sh`.

### Ask the agent

Connect to your app first — `pulseflow_connect` (or pass `{"mock": true}` for a
device-free demo). Then ask in plain language, e.g.:

> What are the top performance problems right now, and what should I fix first?

The agent calls `pulseflow_report` / `pulseflow_problems` and answers with the ranked
issues and concrete fixes. Edit the code, re-measure, repeat.

Tools: session `pulseflow_status`, `pulseflow_discover`, `pulseflow_connect`,
`pulseflow_disconnect`; findings `pulseflow_report`, `pulseflow_problems`,
`pulseflow_widgets`, `pulseflow_frames`, `pulseflow_cpu`, `pulseflow_memory`,
`pulseflow_network`, `pulseflow_device`, `pulseflow_errors`, `pulseflow_logs`;
baselines `pulseflow_snapshot` / `pulseflow_compare`; controls `pulseflow_debug_option`,
`pulseflow_hot_widgets`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Widget probe not available” / empty Widgets | Call `registerPulseFlow`, hot-restart, run in **debug** (not profile/release) |
| App missing from Scan | Paste the full VM Service URL from the `flutter run` console |
| Won't connect, "stale ADB forward" / HTTP 503 | A leftover `adb forward` points at a dead device port. Run `adb forward --remove-all`, then `flutter run` again and use the fresh URL |
| Empty Network panel | Keep `captureNetwork: true`; if you set `HttpOverrides.global` later, chain to the previous override |
| Wrong / missing source files | Set `appPackage` to your pubspec `name`; use debug |
| Scenarios disabled | Release mode, or extensions not registered — restart in debug/profile |
| Bridge / UI won’t connect | Confirm ports 3846 (UI) and 3847 (bridge); `make stop` then `make run` |

---

## Example app

Minimal app under [`example/`](example/):

```bash
cd example
flutter run
```

---

## Development (package contributors)

```yaml
dependencies:
  pulseflow_flutter:
    path: ../pulseflow_flutter
# or
  pulseflow_flutter:
    git:
      url: https://github.com/ialirezairanmanesh/pulseflow_flutter.git
```

```bash
flutter test
flutter analyze
dart pub publish --dry-run
```

Dashboard + bridge: [PulseFlow](https://github.com/ialirezairanmanesh/PulseFlow).

---

## License

MIT — see [LICENSE](LICENSE).
