# PulseFlow

Actionable Flutter performance lab: ranked problems, CPU/flamegraph, repeatable scenarios, memory diffs, network waterfall, and session reports — not a DevTools clone.

**Positioning:** Problems-first UX. Fix what matters first.

## Stack

- Next.js (App Router) + TypeScript + Tailwind + shadcn-style UI primitives
- Recharts for live graphs; `react-flame-graph` for CPU flamegraphs
- Dart bridge (`../pulseflow_bridge`, `package:vm_service`) that proxies the browser to the Dart VM Service. The legacy Node bridge (`server/bridge.ts`) is kept as `npm run bridge:node`.

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
| `/memory` | Heap chart + Snapshots / Diff / Leaks tabs |
| `/network` | Full HTTP list, waterfall, slowest endpoints |
| `/tools` | Lab: stress params, scenarios, before/after baselines |
| `/report` | Agent report (copy/download), Markdown/JSON export, Save session, baselines |
| `/history` | Saved sessions + stat-by-stat comparison |

The bridge WebSocket is shared across pages (React context) — route changes do not reconnect.

## Session history

**Save session** on `/report` persists a snapshot (stats + export payload) to `.data/sessions.json`
on the host via `/api/sessions` (list/create) and `/api/sessions/[id]` (get/delete). The `/history`
page lists saved sessions; select two to compare P95 build/raster/frame, rebuild rate, heap, jank
ratio, and problem count (deltas mark improvements). The store keeps the latest 50 sessions.

## Agent report

**Copy agent report** on `/report` builds a single self-contained Markdown document and copies it
to the clipboard — paste it straight into an AI agent. It opens with a reviewer prompt, then the
ranked problems (with causes and source links), rebuild roots, errors, oversized images, CPU
hotspots, memory growth, slow HTTP, top rebuilding widgets, and session stats. **Agent .md**
downloads the same document as a file. The report is capped per section to stay within token
budgets; `buildAgentReportJson` provides the equivalent structured payload.

## Widget probe + scenarios (Flutter package)

Add the `pulseflow_flutter` package (sibling folder `pulseflow_flutter/`) to your app and register
it from `main()`:

```dart
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  registerPulseFlow(appPackage: 'my_app');
  runApp(const MyApp());
}
```

The older single-file stub (`examples/pulseflow_extension.dart`) still works, but the package adds
accurate frame timing (`addTimingsCallback`), refresh-rate-aware budgets, widget source locations
(`file:line` via the widget inspector), HTTP capture (`HttpOverrides`), and leak signals
(`FlutterMemoryAllocations`).

Hot-restart, reconnect PulseFlow. The bridge will:

1. Start `ext.pulseflow.startWidgetProbe`
2. Poll `ext.pulseflow.getFrameStats` (accurate build/raster/vsync + refresh rate)
3. Poll `ext.pulseflow.getHotWidgets` about every second — ranked by stable id (`route|widget|key`) over a **10s rolling window**, with source locations when available
4. Poll `ext.pulseflow.getNetworkLog` and merge app-captured requests into the network panel
5. Detect scenario RPCs when present

### Extension RPCs

| RPC | Purpose |
| --- | --- |
| `ext.pulseflow.getFrameStats` | Accurate engine frame timings + refresh rate/budget |
| `ext.pulseflow.getRebuildCauses` | Rebuild roots + attributed descendants |
| `ext.pulseflow.getErrors` | Overflow / assertion / exception signatures |
| `ext.pulseflow.getImageStats` | Image cache health + oversized decodes |
| `ext.pulseflow.getNetworkLog` | Drain `HttpOverrides`-captured requests |
| `ext.pulseflow.getLeakReport` | Outstanding (created-not-disposed) objects |
| `ext.pulseflow.injectInvoices` | Stress: append invoices (`count`) |
| `ext.pulseflow.spikeCpu` | Stress: busy-loop (`millis`) |
| `ext.pulseflow.allocateMemory` | Stress: retain buffers (`megabytes`) |
| `ext.pulseflow.startWidgetProbe` / `stopWidgetProbe` / `resetWidgetProbe` / `setWidgetProbeFrozen` / `getHotWidgets` | Rebuild probe (with `sourceUri`/`sourceLine`) |
| `ext.pulseflow.listScenarios` | List built-in scenarios |
| `ext.pulseflow.runScenario` | Run scenario by `id` (+ params) |
| `ext.pulseflow.stopScenario` | Stop running scenario |

Built-in scenarios: `scrollStorm`, `routeThrash`, `listFlood`, `animationFlood`, `retainMemory`, `networkBurst` (stubbed unless you set `PulseFlowStressState.instance.onNetworkBurst`).

Without the package, Build/Raster/memory/CPU/timeline still work via VM Service; Problems explains that the probe is missing; Lab scenarios stay disabled.

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
| `make run` (repo root) | Dashboard + Dart bridge, auto-installing deps |
| `make test` (repo root) | Bridge + Flutter package + dashboard tests |
| `npm run dev` | Dart bridge + Next.js on ports 3847 / 3846 |
| `npm run bridge` | Dart bridge only |
| `npm run bridge:node` | Legacy Node bridge (fallback) |
| `npm run test` | Dashboard unit tests (Vitest) |
| `npm run build` / `npm start` | Production build + serve |
| `npm run lint` | ESLint |

## Headless budget check

`pulseflow_check` connects to a running profile app, runs scenarios, and exits non-zero when
P95 build/raster or the jank ratio exceeds budgets:

```bash
make check VM=ws://127.0.0.1:8181/AUTH=/ws ARGS="--max-p95-build 8 --max-jank-ratio 0.2"
# or directly:
cd pulseflow_bridge && dart run bin/pulseflow_check.dart --vm "$URL" --out report.json
```

Options: `--scenarios`, `--duration-ms`, `--max-p95-build`, `--max-p95-raster`,
`--max-jank-ratio`, `--out`, `--json`. Exit codes: `0` pass, `1` budget violation, `2` setup error.
Requires a debug/profile app with `registerPulseFlow()` — the CLI does not launch a device.

## CPU export

After recording a CPU profile, **Export speedscope** on `/cpu` downloads a
`.speedscope.json` you can open at [speedscope.app](https://www.speedscope.app) for offline
sharing (stacks are emitted root-first). The **Leaks** tab on `/memory` reports outstanding
(created-but-not-disposed) objects via `ext.pulseflow.getLeakReport` (debug/profile only).

## Causes, errors, and images

- **Rebuild causes** (`/problems`, `/widgets`): `ext.pulseflow.getRebuildCauses` attributes each
  rebuild to the nearest widget that also rebuilt in the same frame — a "Rebuild roots" section
  shows the likely triggers, and heavy-rebuild problems read "triggered by <root>".
- **Errors** (`/problems`): `ext.pulseflow.getErrors` counts RenderFlex overflow, assertions, and
  uncaught exceptions per route, ranked as `error_overflow` / `error_exception` problems.
- **Images** (`/memory`): `ext.pulseflow.getImageStats` reports image-cache usage and ranks
  oversized decodes (missing `cacheWidth`/`cacheHeight`), using `debugOnPaintImage`.
- **Editor links**: source locations are clickable (`vscode://file/...:line`) in the Widgets table
  and Problems list when the widget inspector reports an absolute path (debug/profile).
