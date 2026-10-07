# PulseFlow — Feature Implementation Plan

## Vision
PulseFlow is a problems-first Flutter performance lab. The goal of this plan is to
extend the existing three-layer stack (Next.js dashboard ↔ Dart bridge ↔ Flutter app
via VM Service) with high-leverage features that complement (not duplicate) Flutter
DevTools and integrate data from popular pub.dev packages.

## Architecture recap (3 layers)

| Layer | Path | Stack | Role |
|-------|------|-------|------|
| UI dashboard | `docs/pulseflow/` | Next.js 16 + TS + Tailwind + Recharts | 13 route pages + WebSocket client + AI drawer |
| Bridge | `pulseflow_bridge/` | Dart (shelf + vm_service) | WS proxy → Dart VM Service; wire protocol in `types.ts` |
| App-side | `pulseflow_flutter` (sibling) + `examples/pulseflow_extension.dart` | Dart service extensions `ext.pulseflow.*` | rebuild probe, scenarios, stress, image/network/leak data |

## Existing data surface (VM Service + extension RPCs)
- Frame timings (build/raster/vsync/frame, jank) via `Flutter.Frame` extension
- GC events stream
- Memory: getMemoryUsage + getAllocationProfile + snapshot diff + retaining path
- Network: getHttpProfile + app HttpOverrides capture
- CPU: getCpuSamples → top functions + flame tree + speedscope export
- Widget rebuilds (10s rolling window), rebuild causes, source locations
- Errors (overflow/assertion/exception)
- Image cache health + oversized decodes (debugOnPaintImage)
- Timeline (shader/compile/jank/gc markers) + Perfetto export
- Leaks via FlutterMemoryAllocations
- Debug options (DevTools-style overlays)
- Scenarios: scrollStorm, routeThrash, listFlood, animationFlood, retainMemory, networkBurst

## Feature backlog (ranked by impact / effort)

### P0 — High value, low effort
1. **CI budget-check GitHub Action**
   - Reuses `pulseflow_bridge/bin/pulseflow_check.dart` (already supports `--vm`, `--max-p95-build`, `--max-jank-ratio`, `--out`, exit codes 0/1/2).
   - Add `.github/workflows/perf-check.yml` that runs `make check` on PRs.
   - No code changes to bridge/dashboard; pure DevOps.

2. **Session sharing via URL**
   - The PulseStore already keeps state client-side (points, hot widgets, baselines).
   - Serialize a *view* (selected problems filter, frozen hot widgets, recorded window)
     into URL query params so a teammate can open the exact view.
   - Lightweight: encode a base64 snapshot of the relevant slice into the URL hash.

### P1 — High value, moderate effort
3. **Logs / Diagnostics panel**
   - Add `/logs` route + bridge `connect` for the VM Service `Logging` / `Extension` stream.
   - Shows runtime logs, assertion messages, framework text, filter by level.

4. **Device context panel**
   - New `/device` route + AI-context block.
   - Leverage `device_info_plus`, `battery_plus`, `connectivity_plus`,
     `package_info_plus` inside the app extension to expose device specs, battery
     %, network type, app version.  Add an RPC `ext.pulseflow.getDeviceContext`.

### P2 — Nice-to-have polish
5. **PDF export of agent report**
   - Use `html-pdf` or `react-pdf` server-side render of the existing Markdown/HTML
     agent report; add an `Export PDF` button alongside the existing `.md` export.

6. **Regression trend across saved sessions**
   - Extend `.data/sessions.json` usage: plot score/P95/jank across all saved sessions,
     flag regressions automatically on `/history`.

## Execution order
1. CI action  →  2. URL sharing  →  3. Logs panel  →  4. Device context
   (implement in this order; each is independently shippable.)
