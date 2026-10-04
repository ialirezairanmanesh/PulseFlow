# PulseFlow

Actionable Flutter performance lab: ranked problems, CPU/flamegraph, repeatable scenarios, memory diffs, network waterfall, and session reports — not a DevTools clone.

**Positioning:** Problems-first UX. Fix what matters first.

## Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn-style UI primitives
- Recharts for live graphs; `react-flame-graph` for CPU flamegraphs
- Node WebSocket bridge (`server/bridge.ts`) that proxies the browser to the Dart VM Service

Browsers often cannot open arbitrary `ws://` targets (mixed content / localhost quirks). The bridge is required: the UI talks to PulseFlow on port **3847**, and the bridge opens the VM Service socket for you.

## Run the dashboard

```bash
./run.sh
```

Or manually: `npm install && npm run dev`.

Use Node 18+ (Node 22 recommended). If `react-flame-graph` peer warnings appear, `npm install --legacy-peer-deps` is fine (React 19).

- Web UI: [http://127.0.0.1:3846](http://127.0.0.1:3846)
- Bridge health: [http://127.0.0.1:3847](http://127.0.0.1:3847) (`ws://127.0.0.1:3847/bridge`)

Optional env:

```bash
PULSEFLOW_BRIDGE_PORT=3847
NEXT_PUBLIC_BRIDGE_PORT=3847
NEXT_PUBLIC_BRIDGE_HOST=127.0.0.1
```

## Point at a Flutter app

1. Run your Flutter app in **debug/profile** mode (profile preferred for CPU), e.g. `flutter run --profile`.
2. In PulseFlow, click **Find running apps** / **Scan** (it also scans when the bridge connects).
3. Pick an app and click **Connect** — you land on **Problems**.
4. If auth is required, paste the full VM Service URL from `flutter run` as `ws://127.0.0.1:xxxxx/AUTH=/ws`.

Use **Try demo mode** to explore every lab surface without a Flutter app.

## Pages (after Connect)

| Route | Purpose |
| --- | --- |
| `/` | Connect / discover / demo. Redirects to `/problems` when already connected |
| `/problems` | **Primary.** Ranked issues + Record / Freeze + link to Report |
| `/widgets` | Rebuild table (route, app-only, during-jank filters) |
| `/frames` | Build/Raster charts, markers, Export Perfetto |
| `/cpu` | CPU record (3/5/10s), top functions, flamegraph |
| `/memory` | Heap chart + Snapshots / Diff tabs |
| `/network` | Full HTTP list, waterfall, slowest endpoints |
| `/tools` | Lab: stress params, scenarios, before/after baselines |
| `/report` | Markdown/JSON export + baseline compare |

The bridge WebSocket is shared across pages (React context) — route changes do not reconnect.

## Widget probe + scenarios (Flutter stub)

Copy [`examples/pulseflow_extension.dart`](examples/pulseflow_extension.dart) into your Flutter project (e.g. `lib/pulseflow_extension.dart`) and register it:

```dart
void main() {
  registerPulseFlowExtensions();
  runApp(const MyApp());
}
```

Hot-restart, reconnect PulseFlow. The bridge will:

1. Start `ext.pulseflow.startWidgetProbe`
2. Poll `ext.pulseflow.getHotWidgets` about every second
3. Rank rebuilds by stable id (`route|widget|key`) over a **10s rolling window**
4. Detect scenario RPCs when present

### Extension RPCs

| RPC | Purpose |
| --- | --- |
| `ext.pulseflow.injectInvoices` | Stress: append invoices (`count`) |
| `ext.pulseflow.spikeCpu` | Stress: busy-loop (`millis`) |
| `ext.pulseflow.allocateMemory` | Stress: retain buffers (`megabytes`) |
| `ext.pulseflow.startWidgetProbe` / `stopWidgetProbe` / `resetWidgetProbe` / `setWidgetProbeFrozen` / `getHotWidgets` | Rebuild probe |
| `ext.pulseflow.listScenarios` | List built-in scenarios |
| `ext.pulseflow.runScenario` | Run scenario by `id` (+ params) |
| `ext.pulseflow.stopScenario` | Stop running scenario |

Built-in scenarios: `scrollStorm`, `routeThrash`, `listFlood`, `animationFlood`, `retainMemory`, `networkBurst` (stubbed unless you set `PulseFlowStressState.instance.onNetworkBurst`).

Without this stub, Build/Raster/memory/CPU/timeline still work via VM Service; Problems explains that the probe is missing; Lab scenarios stay disabled.

## Bridge protocol (client ↔ bridge)

### Client → server

| type | Notes |
| --- | --- |
| `connect` / `disconnect` / `mock` / `discover` | Connection |
| `refreshExtensions` | Re-detect `ext.pulseflow.*` |
| `stress` | `{ action, params? }` |
| `hotWidgetsControl` | `freeze` \| `unfreeze` \| `reset` |
| `cpuRecord` | `{ action: start\|stop, durationMs? }` |
| `scenario` | `{ action: list\|run\|stop, id?, params? }` |
| `memorySnapshot` | `{ action: capture\|diff\|retainingPath, ... }` |
| `timelineExport` | `{ action: perfetto, durationMs? }` |
| `networkControl` | `{ action: refresh\|clear\|enable }` |

### Server → client

| type | Notes |
| --- | --- |
| `status` / `metrics` / `gc` / `network` / `extension` / `hotWidgets` / `discover` / `error` | Core stream |
| `capabilities` | VM/DDS/extension capability map |
| `cpuProfile` | Aggregated top functions + flame tree |
| `scenarioStatus` | Scenario list / running / result |
| `memoryProfile` | Snapshot / diff / retaining path |
| `timelineExport` | Base64 Perfetto or JSON fallback + markers |

`network` may include `requests[]` batches and optional `sockets[]`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Bridge + Next.js on ports 3847 / 3846 |
| `npm run bridge` | Bridge only |
| `npm run build` / `npm start` | Production build + serve |
| `npm run lint` | ESLint |

## CI sketch (not implemented)

A future headless mode could: start the bridge, connect to a profile VM URL, run `listFlood` / `scrollStorm`, capture a baseline, and fail if P95 build or jank ratio exceeds budgets. Export JSON from `/report` is the current handoff artifact.
