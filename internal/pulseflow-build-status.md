---
cursor:
  subagentId: "bc-547670fa-1932-5030-a802-f43af24578ea"
---

# PulseFlow build status

## Shipped
- Next.js + TypeScript + Tailwind dashboard with shadcn-style primitives and Recharts
- Node WebSocket bridge (`server/bridge.ts`) proxying browser ↔ Dart VM Service
- Connection manager (connect/disconnect/errors) + labeled **demo mode**
- Live charts: CPU/jank, memory/GC, network (graceful degrade)
- Stress controller via `ext.pulseflow.*` + Flutter stub in `examples/pulseflow_extension.dart`
- README with run + Flutter wiring instructions

## How to run
```bash
npm install
npm run dev
```
- App: http://127.0.0.1:3846
- Bridge: http://127.0.0.1:3847 (`ws://127.0.0.1:3847/bridge`)

Branch: `cursor/pulseflow-dashboard-78ea`

## PR
**Blocked:** `ManagePullRequest` refused — repo is `agent_temp` (`mamad-ali/tmp-…`), not a standard Origin repo. User can create a real repo from the New Project “Create repo” control, then open a PR from this branch.

## Media (verified)
- `/cursor/stores/self/media/pulseflow-dashboard-connect.png`
- `/cursor/stores/self/media/pulseflow-dashboard-desktop.png`

Absolute store paths:
- `/cursor/stores/bc-885485ef-d028-4c8b-8741-1c001dc5cb12/media/pulseflow-dashboard-connect.png`
- `/cursor/stores/bc-885485ef-d028-4c8b-8741-1c001dc5cb12/media/pulseflow-dashboard-desktop.png`

## Known VM Service metric limitations
- **CPU** is a lightweight pressure estimate from frame cost vs 16.67ms, not a full CPU profiler
- **Frames/jank** depend on `Flutter.Frame` Extension / Timeline events (debug/profile Flutter)
- **Memory** uses `getMemoryUsage`, falling back to `getAllocationProfile`
- **Network** uses `getHttpProfile` (typically via DDS); unavailable VMs show an empty/degraded panel with a clear message
- Stress RPCs require the PulseFlow Flutter stub (`ext.pulseflow.*`); UI surfaces “extension missing” when absent
