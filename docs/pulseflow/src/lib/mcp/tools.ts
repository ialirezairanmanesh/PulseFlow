/**
 * Declarative MCP tool registry for PulseFlow.
 *
 * Pure of Node/browser APIs: handlers receive a {@link ToolContext} whose
 * `send`/`waitFor`/`writeFile`/`log` are provided by the server, so the whole
 * registry is unit-testable with a fake bridge.
 */
import type {
  BridgeClientMessage,
  BridgeServerMessage,
  DebugOptionId,
  PerformanceProblem,
} from "@/lib/types";
import type { SavedSession } from "@/lib/session-history";
import {
  compareSessions,
  diffProblems,
  formatDelta,
  pctChange,
  summarizeComparison,
  summarizeProblemDiff,
} from "@/lib/session-history";
import {
  clearTelemetry,
  focusedStateOf,
  hasTelemetry,
  problemsOf,
  reportJsonOf,
  reportMarkdownOf,
  resetTelemetry,
  sessionStatsOf,
  verdictOf,
  type FocusOptions,
  type McpSessionState,
} from "@/lib/mcp/session-state";

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolTextContent[];
  isError?: boolean;
}

export interface ToolContext {
  state: McpSessionState;
  /** Named before/after baselines captured with `pulseflow_snapshot`. */
  snapshots: Map<string, SavedSession>;
  send(msg: BridgeClientMessage): void;
  waitFor(
    type: BridgeServerMessage["type"],
    timeoutMs?: number,
    predicate?: (msg: BridgeServerMessage) => boolean,
  ): Promise<BridgeServerMessage | null>;
  /** Writes a file under the OS temp dir and returns its absolute path. */
  writeFile(fileName: string, content: string): string;
  log(message: string): void;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

const NO_ARGS: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: false };

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

function numArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const raw = args[key];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const FOCUS_PROPERTIES: Record<string, unknown> = {
  route: { type: "string", description: "Route focus, e.g. /MainPage. Filters hot widgets, stalls, errors, rebuild roots." },
  excludeFirstSec: {
    type: "number",
    description: "Drop frame samples from the first N seconds of the session (cold start / warmup). Dashboard options: 2, 5, 10, 20.",
  },
  windowMs: { type: "number", description: "Keep only frame samples from the last N ms of the buffer." },
};

function focusArgs(args: Record<string, unknown>): FocusOptions {
  const route = typeof args.route === "string" ? args.route.trim() : "";
  return {
    route: route || undefined,
    excludeFirstSec: numArg(args, "excludeFirstSec", 0),
    windowMs: numArg(args, "windowMs", 0) || undefined,
  };
}

function problemLine(p: PerformanceProblem): string {
  const where = [
    p.widget ? `\`${p.widget}\`` : "",
    p.route ? `on ${p.route}` : "",
    p.sourceUri ? `${p.sourceUri}${p.sourceLine ? `:${p.sourceLine}` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const evidence = [
    p.impact != null ? `impact ${p.impact}` : "",
    p.ratePerSec != null && p.kind !== "slow_http" ? `${p.ratePerSec.toFixed(1)}/s` : "",
    p.share != null ? `${p.share.toFixed(1)}% share` : "",
    p.latencyMs != null ? `${p.latencyMs.toFixed(0)} ms` : "",
    p.duringJank ? "during jank" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `- [${p.severity.toUpperCase()}] ${p.title}${where ? ` — ${where}` : ""}`,
    p.why ? `  why: ${p.why}` : "",
    `  fix: ${p.action}`,
    evidence ? `  evidence: ${evidence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function problemsMarkdown(problems: PerformanceProblem[]): string {
  if (!problems.length) return "_No ranked problems in this session._";
  return problems.map(problemLine).join("\n\n");
}

/** Capture the current session as a comparable baseline. */
function snapshotFromState(state: McpSessionState, label: string): SavedSession {
  return {
    id: label,
    label,
    savedAt: Date.now(),
    mode: state.mode,
    isolateName: state.isolateName,
    stats: sessionStatsOf(state),
    problems: problemsOf(state),
    report: null,
  };
}

/** Markdown diff of two baselines: metric deltas + fixed/new/persisting problems. */
function compareMarkdown(before: SavedSession, after: SavedSession): string {
  const rows = compareSessions(before, after);
  const summary = summarizeComparison(rows);
  const diff = diffProblems(before, after);
  const pdiff = summarizeProblemDiff(diff);

  const lines: string[] = [
    `# PulseFlow compare: "${before.label ?? before.id}" → "${after.label ?? after.id}"`,
    "",
    `**${pdiff.headline}**`,
    summary.headline,
    "",
    "## Metrics",
    "",
    "| Metric | Before | After | Delta |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const delta =
      row.delta === 0
        ? "no change"
        : row.key === "jankRatio"
          ? formatDelta(row.key, row.delta)
          : `${formatDelta(row.key, row.delta)} (${pctChange(row.key, row.before, row.after)})`;
    lines.push(
      `| ${row.label} | ${row.before.toFixed(2)} | ${row.after.toFixed(2)} | ${delta} |`,
    );
  }
  if (diff.fixed.length) {
    lines.push("", `## Fixed (${diff.fixed.length})`, "", problemsMarkdown(diff.fixed));
  }
  if (diff.added.length) {
    lines.push("", `## New / regressed (${diff.added.length})`, "", problemsMarkdown(diff.added));
  }
  if (diff.persisting.length) {
    lines.push("", `## Still open (${diff.persisting.length})`, "");
    for (const p of diff.persisting) {
      lines.push(
        `- [${p.after.severity.toUpperCase()}] ${p.after.title} — impact ${
          p.impactDelta >= 0 ? "+" : ""
        }${p.impactDelta}`,
        `  fix: ${p.after.action}`,
      );
    }
  }
  return lines.join("\n");
}

/** Best-effort target for `connect` when no url is given. */
async function discoverAndConnect(ctx: ToolContext): Promise<string> {
  ctx.send({ type: "discover" });
  const found = await ctx.waitFor("discover", 10_000);
  if (!found || found.type !== "discover") {
    return "Discover timed out — is the PulseFlow bridge running on port 3847?";
  }
  const app = found.apps.find((a) => a.connectable) ?? found.apps[0];
  if (!app) {
    return "No running Flutter apps discovered. Start the app (e.g. on redroid) and retry.";
  }
  ctx.send({ type: "connect", url: app.wsUrl });
  await ctx.waitFor("status", 8_000);
  return `Connecting to ${app.name ?? app.deviceSerial ?? app.wsUrl} (${app.wsUrl})…`;
}

export const TOOLS: ToolDef[] = [
  {
    name: "pulseflow_status",
    description:
      "PulseFlow bridge + session status: whether the bridge is reachable, the connection state, live/mock mode, isolate, VM capabilities, build mode, and a one-line health verdict. Call this first to know whether you need pulseflow_connect.",
    inputSchema: NO_ARGS,
    handler: (ctx) => {
      const s = ctx.state;
      const problems = problemsOf(s);
      return json({
        bridgeReady: s.bridgeReady,
        status: s.status,
        statusMessage: s.statusMessage,
        mode: s.mode ?? null,
        isolateName: s.isolateName ?? null,
        error: s.error ?? null,
        buildMode: s.buildInfo?.buildMode ?? null,
        probes: s.buildInfo?.probes ?? null,
        capabilities: s.capabilities,
        hasTelemetry: hasTelemetry(s),
        messagesSeen: s.messageCount,
        problems: problems.length,
      });
    },
  },
  {
    name: "pulseflow_discover",
    description:
      "List running Flutter apps the bridge can connect to (ADB / mDNS / port scan), with their VM Service ws URL and device serial.",
    inputSchema: NO_ARGS,
    handler: async (ctx) => {
      ctx.send({ type: "discover" });
      const msg = await ctx.waitFor("discover", 10_000);
      if (!msg || msg.type !== "discover") return text("Discover timed out.", true);
      return json({ apps: msg.apps });
    },
  },
  {
    name: "pulseflow_connect",
    description:
      "Connect the bridge to a Flutter app's VM Service. Provide `url` (ws://…/ws), or `serial` (ADB serial like localhost:5555) to connect via ADB, or `mock:true` for a device-free demo session. With no arguments it discovers and connects to the first running app.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "VM Service WebSocket URL, e.g. ws://127.0.0.1:8181/ws" },
        serial: { type: "string", description: "ADB serial, e.g. localhost:5555" },
        mock: { type: "boolean", description: "Start a device-free mock session" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      // Fresh session per connect, like the dashboard's connect/mock (no stale warmup anchor or samples).
      clearTelemetry(ctx.state);
      if (args.mock === true) {
        ctx.send({ type: "mock" });
        await ctx.waitFor("status", 5_000);
        return text("Started a mock (demo) session. Call pulseflow_report next.");
      }
      if (typeof args.url === "string" && args.url.trim()) {
        const url = args.url.trim();
        ctx.send({ type: "connect", url });
        const status = await ctx.waitFor("status", 8_000);
        return json({ connecting: url, status: status?.type === "status" ? status.status : "sent" });
      }
      if (typeof args.serial === "string" && args.serial.trim()) {
        const serial = args.serial.trim();
        ctx.send({ type: "discover" });
        const found = await ctx.waitFor("discover", 10_000);
        const app = found && found.type === "discover"
          ? found.apps.find((a) => a.deviceSerial === serial) ??
            found.apps.find((a) => a.wsUrl.includes(serial))
          : undefined;
        if (!app) return text(`No discovered app with ADB serial "${serial}".`, true);
        ctx.send({ type: "connect", url: app.wsUrl });
        await ctx.waitFor("status", 8_000);
        return text(`Connecting to ${app.name ?? serial} (${app.wsUrl})…`);
      }
      return text(await discoverAndConnect(ctx));
    },
  },
  {
    name: "pulseflow_disconnect",
    description: "Disconnect the bridge from the current app and clear telemetry.",
    inputSchema: NO_ARGS,
    handler: (ctx) => {
      ctx.send({ type: "disconnect" });
      clearTelemetry(ctx.state);
      return text("Disconnected. Telemetry cleared.");
    },
  },
  {
    name: "pulseflow_report",
    description:
      "The full agent-ready brief for the current session — ranked problems with impact/severity/why/fix/evidence, coverage gaps, rebuild roots, errors, CPU hotspots, memory growth, slow HTTP, and top rebuilding widgets. This is the same output as the dashboard's 'Copy agent report'. Use it to find what to fix.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["markdown", "json"], description: "Output format (default markdown)" },
        write: { type: "boolean", description: "Also write the report to a temp file and return its path" },
        ...FOCUS_PROPERTIES,
      },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const format = args.format === "json" ? "json" : "markdown";
      const { state: focused } = focusedStateOf(ctx.state, focusArgs(args));
      const content =
        format === "json" ? JSON.stringify(reportJsonOf(focused), null, 2) : reportMarkdownOf(focused);
      let suffix = "";
      if (args.write === true) {
        const ext = format === "json" ? "json" : "md";
        const path = ctx.writeFile(`pulseflow-report-${Date.now()}.${ext}`, content);
        suffix = `\n\n_Saved to ${path}_`;
      }
      return text(content + suffix);
    },
  },
  {
    name: "pulseflow_problems",
    description:
      "Ranked performance problems for the current session (highest impact first), each with severity, the measured evidence, a plain-language cause, and a concrete fix. Backed by the same ranking the dashboard and CI check use.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max problems to return (default 12)" },
        ...FOCUS_PROPERTIES,
      },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const limit = numArg(args, "limit", 12);
      const { state: focused } = focusedStateOf(ctx.state, focusArgs(args));
      const problems = problemsOf(focused).slice(0, limit);
      const stats = sessionStatsOf(focused);
      return text(
        [
          `# PulseFlow problems (${problems.length})`,
          `P95 build ${stats.p95BuildMs} ms · raster ${stats.p95RasterMs} ms · jank ${(stats.jankRatio * 100).toFixed(0)}%`,
          "",
          problemsMarkdown(problems),
        ].join("\n"),
      );
    },
  },
  {
    name: "pulseflow_snapshot",
    description:
      "Save the current session under a name (e.g. \"before\") so you can compare it after a fix with pulseflow_compare. Captures the ranked problems and headline metrics.",
    inputSchema: {
      type: "object",
      properties: { label: { type: "string", description: "Baseline name, e.g. before / after" } },
      required: ["label"],
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const label = String(args.label ?? "").trim();
      if (!label) return text("label is required", true);
      const snapshot = snapshotFromState(ctx.state, label);
      ctx.snapshots.set(label, snapshot);
      return text(
        `Saved baseline "${label}" — ${snapshot.stats.problemCount} problems, P95 build ${snapshot.stats.p95BuildMs} ms.`,
      );
    },
  },
  {
    name: "pulseflow_compare",
    description:
      "Compare two baselines saved with pulseflow_snapshot and report what changed: metric deltas plus fixed / new / still-open problems with impact changes. Use it to confirm a fix actually helped.",
    inputSchema: {
      type: "object",
      properties: {
        before: { type: "string", description: "Label of the earlier baseline" },
        after: { type: "string", description: "Label of the later baseline" },
      },
      required: ["before", "after"],
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const before = ctx.snapshots.get(String(args.before ?? ""));
      const after = ctx.snapshots.get(String(args.after ?? ""));
      if (!before || !after) {
        const known = [...ctx.snapshots.keys()].join(", ") || "(none)";
        return text(
          `Unknown baseline(s). Saved: ${known}. Capture with pulseflow_snapshot first.`,
          true,
        );
      }
      return text(compareMarkdown(before, after));
    },
  },
  {
    name: "pulseflow_widgets",
    description:
      "Hottest rebuilding widgets for the current route/window — name, route, rebuilds/s, share %, source file:line, and rebuild root cause — plus per-screen totals and rebuild roots.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max widgets (default 12)" }, ...FOCUS_PROPERTIES },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const limit = numArg(args, "limit", 12);
      const { state: s } = focusedStateOf(ctx.state, focusArgs(args));
      if (!s.hot) {
        return json({ available: false, message: s.hotMessage ?? "No widget data yet — interact with the app.", widgets: [], screens: [], roots: [] });
      }
      const widgets = [...(s.hot.widgets ?? [])]
        .sort((a, b) => b.ratePerSec - a.ratePerSec)
        .slice(0, limit)
        .map((w) => ({
          name: w.name,
          route: w.route,
          ratePerSec: w.ratePerSec,
          share: w.share,
          source: w.sourceUri ? `${w.sourceUri}${w.sourceLine ? `:${w.sourceLine}` : ""}` : undefined,
          cause: w.cause,
          isFramework: w.isFramework,
          duringJank: w.duringJank,
          childProvided: w.childProvided,
          childReused: w.childReused,
        }));
      const builderChildRebuilt = (s.hot.widgets ?? [])
        .filter((w) => w.childProvided && w.childReused === false)
        .slice(0, 8)
        .map((w) => ({ name: w.name, route: w.route, ratePerSec: w.ratePerSec }));
      return json({
        available: s.hot.available,
        windowMs: s.hot.windowMs,
        currentRoute: s.hot.currentRoute ?? null,
        widgets,
        builderChildRebuilt,
        screens: (s.hot.screens ?? []).slice(0, 8),
        roots: s.rebuildCauses?.roots?.slice(0, 10) ?? [],
      });
    },
  },
  {
    name: "pulseflow_frames",
    description:
      "Frame-budget health: P95 build/raster vs the device frame budget, jank ratio, latest frame, and UI stalls (main-isolate freezes). Pass route / excludeFirstSec / windowMs to match the dashboard's focus filters; `focus` in the output shows what was applied.",
    inputSchema: {
      type: "object",
      properties: FOCUS_PROPERTIES,
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const { state: s, info } = focusedStateOf(ctx.state, focusArgs(args));
      const latest = s.points.at(-1);
      const stats = sessionStatsOf(s);
      return json({
        focus: info,
        samples: s.points.length,
        p95BuildMs: stats.p95BuildMs,
        p95RasterMs: stats.p95RasterMs,
        p95FrameMs: stats.p95FrameMs,
        jankRatio: stats.jankRatio,
        refreshRate: latest?.refreshRate ?? null,
        budgetMs: latest?.buildBudgetMs ?? null,
        stalls: s.stalls,
      });
    },
  },
  {
    name: "pulseflow_focus_snapshot",
    description:
      "Dashboard-equivalent view of the session under the same focus filters the Focus UI uses (route, excludeFirstSec, windowMs): frame stats, verdict, and ranked problems computed on the filtered data. Use this instead of pulseflow_problems when comparing to what the dashboard shows.",
    inputSchema: {
      type: "object",
      properties: {
        ...FOCUS_PROPERTIES,
        limit: { type: "number", description: "Max problems to return (default 12)" },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const { state: s, info } = focusedStateOf(ctx.state, focusArgs(args));
      const limit = numArg(args, "limit", 12);
      const problems = problemsOf(s);
      const stats = sessionStatsOf(s);
      const verdict = verdictOf(s);
      return json({
        focus: info,
        verdict,
        stats,
        problems: problems.slice(0, limit).map((p) => ({
          severity: p.severity,
          title: p.title,
          route: p.route ?? null,
          widget: p.widget ?? null,
          source: p.sourceUri ? `${p.sourceUri}${p.sourceLine ? `:${p.sourceLine}` : ""}` : null,
          action: p.action,
        })),
        totalProblems: problems.length,
      });
    },
  },
  {
    name: "pulseflow_reset_telemetry",
    description:
      "Start a clean measurement without disconnecting: clears frame samples, GC events, and stalls, and re-anchors the warmup clock to the next sample. Optional flags also clear network, errors, and hot-widget counters (hot also resets the app-side rebuild counters).",
    inputSchema: {
      type: "object",
      properties: {
        network: { type: "boolean", description: "Also clear network requests and sockets" },
        errors: { type: "boolean", description: "Also clear captured runtime errors" },
        hot: { type: "boolean", description: "Also clear hot-widget counters (sends a reset to the app)" },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const opts = {
        network: args.network === true,
        errors: args.errors === true,
        hot: args.hot === true,
      };
      resetTelemetry(ctx.state, opts);
      if (opts.hot) ctx.send({ type: "hotWidgetsControl", action: "reset" });
      return text(
        `Telemetry reset (samples, GC, stalls${opts.network ? ", network" : ""}${opts.errors ? ", errors" : ""}${opts.hot ? ", hot widgets" : ""}). Warmup clock restarts at the next frame sample.`,
      );
    },
  },
  {
    name: "pulseflow_cpu",
    description:
      "CPU hotspots by self-time. Optionally pass `recordMs` to record a fresh profile first (the app must run in profile mode). Returns top functions with self/total %.",
    inputSchema: {
      type: "object",
      properties: { recordMs: { type: "number", description: "Record for this many ms before returning (e.g. 4000)" } },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const recordMs = numArg(args, "recordMs", 0);
      if (recordMs > 0) {
        ctx.send({ type: "cpuRecord", action: "start", durationMs: recordMs });
        // Wait for the finished profile, not the "recording" acknowledgement.
        await ctx.waitFor(
          "cpuProfile",
          recordMs + 30_000,
          (m) => m.type === "cpuProfile" && m.recording === false,
        );
      }
      const profile = ctx.state.cpuProfile;
      if (!profile) {
        return json({ available: false, message: ctx.state.cpuMessage ?? "No CPU profile captured." });
      }
      return json({
        available: true,
        durationMs: profile.durationMs,
        sampleCount: profile.sampleCount,
        hotspots: profile.topFunctions.slice(0, 12).map((f) => ({
          name: f.qualifiedName,
          selfPercent: f.selfPercent,
          totalPercent: f.totalPercent,
          codeUri: f.codeUri,
        })),
      });
    },
  },
  {
    name: "pulseflow_memory",
    description:
      "Memory picture: heap growth between snapshots, leaks, and image-cache waste. `action`: 'auto' (current), 'capture' (snapshot now), 'diff' (capture + diff), 'leaks' (leak report), or 'around_scenario' — capture, run `scenario`, capture, diff — so the growth is attributable to that scenario.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["auto", "capture", "diff", "leaks", "around_scenario"],
          description: "Default auto",
        },
        scenario: {
          type: "string",
          description: "Scenario id for around_scenario, e.g. listFlood / retainMemory",
        },
      },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const action = typeof args.action === "string" ? args.action : "auto";
      let note: string | undefined;
      if (action === "capture" || action === "diff") {
        ctx.send({ type: "memorySnapshot", action: "capture" });
        await ctx.waitFor("memoryProfile", 10_000, (m) => m.type === "memoryProfile" && !!m.snapshot);
        if (action === "diff") {
          ctx.send({ type: "memorySnapshot", action: "diff" });
          await ctx.waitFor("memoryProfile", 10_000, (m) => m.type === "memoryProfile" && !!m.diff);
        }
      } else if (action === "leaks") {
        ctx.send({ type: "leakControl", action: "report" });
        await ctx.waitFor("leaks", 10_000);
      } else if (action === "around_scenario") {
        const scenario = typeof args.scenario === "string" ? args.scenario.trim() : "";
        if (!scenario) return text("`scenario` id is required for action=around_scenario", true);
        ctx.send({ type: "memorySnapshot", action: "capture" });
        await ctx.waitFor("memoryProfile", 15_000, (m) => m.type === "memoryProfile" && !!m.snapshot);
        ctx.send({ type: "scenario", action: "run", id: scenario });
        const done = await ctx.waitFor(
          "scenarioStatus",
          65_000,
          (m) => m.type === "scenarioStatus" && m.running === null,
        );
        const result = done && done.type === "scenarioStatus" ? done.result : undefined;
        ctx.send({ type: "memorySnapshot", action: "capture" });
        await ctx.waitFor("memoryProfile", 15_000, (m) => m.type === "memoryProfile" && !!m.snapshot);
        ctx.send({ type: "memorySnapshot", action: "diff" });
        await ctx.waitFor("memoryProfile", 15_000, (m) => m.type === "memoryProfile" && !!m.diff);
        note = result
          ? `Scenario ${scenario}: ${result.ok ? "ok" : `failed (${result.reason ?? "unknown"})`}`
          : `Scenario ${scenario}: no completion within 65s`;
      }
      const s = ctx.state;
      return json({
        snapshots: s.memorySnapshots.map((m) => ({ id: m.id, heapMb: m.heapMb, externalMb: m.externalMb })),
        grew: s.memoryDiff?.grew?.slice(0, 12) ?? [],
        leaks: s.leaks.slice(0, 12),
        imageCache: s.images?.cache ?? null,
        oversizedImages: s.images?.oversized?.slice(0, 12) ?? [],
        message: note ?? s.memoryMessage ?? null,
      });
    },
  },
  {
    name: "pulseflow_network",
    description:
      "Network picture: slowest HTTP requests by latency (UX wait time — not frame cost), plus open sockets.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max requests (default 10)" } },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const limit = numArg(args, "limit", 10);
      const s = ctx.state;
      const slow = [...s.network].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, limit);
      return json({
        available: s.networkAvailable,
        requests: slow,
        sockets: s.sockets.slice(0, 20),
        message: s.networkMessage ?? null,
      });
    },
  },
  {
    name: "pulseflow_device",
    description:
      "Device context: platform, build mode, display refresh rate + frame budget, DPR, physical size, locale, text scale, and app package.",
    inputSchema: NO_ARGS,
    handler: (ctx) => json(ctx.state.deviceContext ?? { available: false, message: "Device context unavailable." }),
  },
  {
    name: "pulseflow_errors",
    description: "Runtime errors captured this session: overflow, assertions, and exceptions, with counts and routes.",
    inputSchema: NO_ARGS,
    handler: (ctx) => json({ errors: ctx.state.appErrors }),
  },
  {
    name: "pulseflow_logs",
    description:
      "Recent runtime log stream (VM Service Logging channel). Filter by minimum `level` (debug|info|warning|error|severe).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries, newest last (default 100)" },
        level: { type: "string", enum: ["debug", "info", "warning", "error", "severe"] },
      },
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const limit = numArg(args, "limit", 100);
      const order = { debug: 0, info: 1, warning: 2, error: 3, severe: 4 } as const;
      const min = typeof args.level === "string" && args.level in order ? order[args.level as keyof typeof order] : 0;
      const logs = ctx.state.logs.filter((l) => (order[l.level] ?? 0) >= min).slice(-limit);
      return json({ count: logs.length, logs });
    },
  },
  {
    name: "pulseflow_debug_option",
    description:
      "Read or toggle a Flutter debug overlay (same as DevTools Inspector): performanceOverlay, debugPaint, debugPaintBaselines, repaintRainbow, invertOversizedImages, debugBanner, slowAnimations.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          enum: [
            "performanceOverlay",
            "debugPaint",
            "debugPaintBaselines",
            "repaintRainbow",
            "invertOversizedImages",
            "debugBanner",
            "slowAnimations",
          ],
        },
        enabled: { type: "boolean", description: "Omit to just read the current state" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = typeof args.id === "string" ? args.id : undefined;
      if (!id) return json({ options: ctx.state.debugOptions });
      if (typeof args.enabled === "boolean") {
        ctx.send({ type: "debugOptions", action: "set", id: id as DebugOptionId, enabled: args.enabled });
        await ctx.waitFor("debugOptions", 5_000);
      }
      return json({ options: ctx.state.debugOptions });
    },
  },
  {
    name: "pulseflow_hot_widgets",
    description:
      "'freeze' holds the widget rebuild ranks still while you inspect; 'unfreeze' resumes live sampling; 'reset' clears the counters to start a clean measurement.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["freeze", "unfreeze", "reset"] } },
      required: ["action"],
      additionalProperties: false,
    },
    handler: (ctx, args) => {
      const action = args.action;
      if (action !== "freeze" && action !== "unfreeze" && action !== "reset") {
        return text("action must be freeze, unfreeze, or reset", true);
      }
      ctx.send({ type: "hotWidgetsControl", action });
      return text(`Widget ranks: ${action}.`);
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
