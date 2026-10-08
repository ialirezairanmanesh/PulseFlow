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

### Package round (pulseflow_flutter 0.2) — in progress
Ship app-side signals first; bridge/dashboard consume them over the wire.

| # | Item | Layer | Status |
|---|------|-------|--------|
| A | `ext.pulseflow.getDeviceContext` — platform, display, locale, text scale, optional enricher | package + bridge | **done** (wire) |
| B | Custom scenario registry (`registerPulseFlowScenario`) + list/run | package | **doing** |
| C | UI stall probe (`ext.pulseflow.getStallReport`) — main-isolate freeze > threshold | package + bridge | **done** (wire) |
| D | Real `networkBurst` default + URI query redact for secrets | package | **doing** |
| E | Dashboard `/device` page + Problems stall cards | dashboard | **done** |
| F | Platform-channel timing probe | package | later |
| G | Shader / cold-start markers as first-class RPC | package | later |

### P0 — High value, low effort (dashboard/DevOps)
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

4. **Device context panel** (depends on package item A) — **done**
   - `/device` route + Problems/Frames stall surfacing + AI-context device/stalls blocks.
   - Optional app enricher can attach battery / connectivity / version without forcing
     plugin deps into `pulseflow_flutter`.

### P2 — Nice-to-have polish
5. **PDF export of agent report**
   - Use `html-pdf` or `react-pdf` server-side render of the existing Markdown/HTML
     agent report; add an `Export PDF` button alongside the existing `.md` export.

6. **Regression trend across saved sessions**
   - Extend `.data/sessions.json` usage: plot score/P95/jank across all saved sessions,
     flag regressions automatically on `/history`.

## Execution order
1. Package A–D (device / scenarios / stalls / network) → bridge wire
2. CI action → URL sharing → Logs panel → `/device` UI
   (each independently shippable.)
