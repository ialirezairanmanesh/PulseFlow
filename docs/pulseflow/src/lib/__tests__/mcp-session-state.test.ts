import { describe, expect, it, vi } from "vitest";
import {
  applyMessage,
  createSessionState,
  hasTelemetry,
  problemsOf,
  reportJsonOf,
  reportMarkdownOf,
  sessionStatsOf,
  verdictOf,
} from "@/lib/mcp/session-state";
import { findTool, TOOL_NAMES, TOOLS, type ToolContext } from "@/lib/mcp/tools";
import type {
  BridgeMetricsMessage,
  BridgeServerMessage,
  MetricPoint,
  PerformanceProblem,
} from "@/lib/types";

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    t: 1000,
    cpu: 40,
    framePressure: 40,
    frameMs: 15,
    buildMs: 6,
    rasterMs: 8,
    vsyncMs: 0,
    jank: 0,
    heapMb: 100,
    externalMb: 8,
    ...overrides,
  };
}

function metrics(p: Partial<MetricPoint>): BridgeMetricsMessage {
  return { type: "metrics", point: point(p) };
}

function hotWidgets(): BridgeServerMessage {
  return {
    type: "hotWidgets",
    available: true,
    windowMs: 10000,
    totalRebuildsWindow: 100,
    totalRebuildsSession: 100,
    currentRoute: "/invoices",
    widgets: [
      {
        id: "/invoices|InvoiceCard|",
        name: "InvoiceCard",
        route: "/invoices",
        rebuildsSession: 60,
        rebuildsWindow: 60,
        ratePerSec: 22,
        share: 60,
        lastSeenMs: 0,
        isFramework: false,
        cause: "InvoiceListState",
        sourceUri: "lib/invoice/card.dart",
        sourceLine: 42,
      },
    ],
    screens: [],
  };
}

function scripted(): ReturnType<typeof createSessionState> {
  const state = createSessionState();
  const messages: BridgeServerMessage[] = [
    { type: "status", status: "connected", mode: "live", isolateName: "main" },
    metrics({ buildMs: 30, rasterMs: 31, frameMs: 61, jank: 1 }),
    hotWidgets(),
    { type: "buildInfo", buildMode: "debug", probes: { rebuildProbe: true } },
    {
      type: "rebuildCauses",
      available: true,
      windowMs: 10000,
      roots: [
        { id: "r", widget: "InvoiceListState", route: "/invoices", cause: "self", rebuilds: 36, ratePerSec: 3.6, children: 2 },
      ],
      attributed: [],
    },
    {
      type: "errors",
      available: true,
      total: 1,
      errors: [{ kind: "overflow", signature: "RenderFlex overflowed", count: 2, route: "/invoices", top: ["#0 RenderFlex.performLayout"] }],
    },
  ];
  for (const m of messages) applyMessage(state, m);
  return state;
}

describe("session-state reducer", () => {
  it("accumulates status, metrics and hot widgets", () => {
    const state = scripted();
    expect(state.status).toBe("connected");
    expect(state.mode).toBe("live");
    expect(state.isolateName).toBe("main");
    expect(state.points).toHaveLength(1);
    expect(state.hot?.widgets[0]?.name).toBe("InvoiceCard");
    expect(state.rebuildCauses?.roots[0]?.widget).toBe("InvoiceListState");
    expect(state.appErrors).toHaveLength(1);
    expect(hasTelemetry(state)).toBe(true);
  });

  it("ranks problems with evidence (widget + route + source)", () => {
    const problems = problemsOf(scripted());
    expect(problems.length).toBeGreaterThan(0);
    const build = problems.find((p: PerformanceProblem) => p.kind === "high_build");
    expect(build?.severity).toBe("high");
    const rebuild = problems.find((p) => p.widget === "InvoiceCard");
    expect(rebuild?.route).toBe("/invoices");
  });

  it("produces a health verdict", () => {
    const verdict = verdictOf(scripted());
    expect(verdict.status).toBe("bad");
    expect(verdict.score).toBeLessThan(50);
    expect(verdict.budgets.some((b) => !b.passed)).toBe(true);
  });

  it("builds session stats and the agent report", () => {
    const state = scripted();
    const stats = sessionStatsOf(state);
    expect(stats.problemCount).toBeGreaterThan(0);
    expect(stats.jankRatio).toBeCloseTo(1, 5);

    const md = reportMarkdownOf(state);
    expect(md).toContain("# PulseFlow agent report");
    expect(md).toContain("InvoiceCard");
    expect(md).toContain("## Output format (follow exactly)");

    const json = reportJsonOf(state);
    expect(json.kind).toBe("agent-report");
    expect(json.problems.length).toBeGreaterThan(0);
  });

  it("buffers network requests by id and clears on empty list", () => {
    const state = createSessionState();
    applyMessage(state, {
      type: "network",
      available: true,
      request: { id: "a", t: 0, method: "GET", uri: "/x", latencyMs: 900, requestBytes: 1, responseBytes: 2, status: 200 },
    });
    expect(state.network).toHaveLength(1);
    applyMessage(state, {
      type: "network",
      available: true,
      request: { id: "a", t: 0, method: "GET", uri: "/x", latencyMs: 950, requestBytes: 1, responseBytes: 2, status: 200 },
    });
    expect(state.network).toHaveLength(1);
    expect(state.network[0].latencyMs).toBe(950);
    applyMessage(state, { type: "network", available: true, requests: [] });
    expect(state.network).toHaveLength(0);
  });

  it("keeps frozen widget ranks", () => {
    const state = createSessionState();
    const frozen = { ...hotWidgets(), frozen: true } as BridgeServerMessage;
    applyMessage(state, frozen);
    expect(state.probeFrozen).toBe(true);
    applyMessage(state, hotWidgets());
    // A non-frozen update while frozen must not overwrite the held snapshot.
    expect(state.probeFrozen).toBe(true);
  });
});

function fakeContext(state = scripted()): { ctx: ToolContext; sent: unknown[] } {
  const sent: unknown[] = [];
  const ctx: ToolContext = {
    state,
    snapshots: new Map(),
    send: (m) => sent.push(m),
    waitFor: vi.fn().mockResolvedValue(null),
    writeFile: (name) => `/tmp/${name}`,
    log: () => {},
  };
  return { ctx, sent };
}

describe("tool registry", () => {
  it("exposes uniquely named tools with JSON schemas", () => {
    expect(TOOL_NAMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("pulseflow_status reports connection + counts", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_status")!.handler(ctx, {});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.status).toBe("connected");
    expect(payload.problems).toBeGreaterThan(0);
  });

  it("pulseflow_problems returns ranked markdown", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_problems")!.handler(ctx, { limit: 5 });
    expect(res.content[0].text).toContain("InvoiceCard");
    expect(res.content[0].text).toMatch(/fix:/);
  });

  it("pulseflow_report writes to a file when asked", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_report")!.handler(ctx, { write: true });
    expect(res.content[0].text).toContain("Saved to /tmp/");
  });

  it("pulseflow_widgets sorts by rebuild rate", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_widgets")!.handler(ctx, {});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.widgets[0].name).toBe("InvoiceCard");
    expect(payload.roots[0].widget).toBe("InvoiceListState");
  });

  it("pulseflow_logs filters by level", async () => {
    const state = createSessionState();
    applyMessage(state, { type: "log", entry: { id: "1", t: 1, level: "debug", severity: 500, message: "a" } } as never);
    applyMessage(state, { type: "log", entry: { id: "2", t: 2, level: "error", severity: 1000, message: "b" } } as never);
    const { ctx } = fakeContext(state);
    const res = await findTool("pulseflow_logs")!.handler(ctx, { level: "warning" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.logs).toHaveLength(1);
    expect(payload.logs[0].message).toBe("b");
  });

  it("pulseflow_hot_widgets sends the control message", async () => {
    const { ctx, sent } = fakeContext();
    await findTool("pulseflow_hot_widgets")!.handler(ctx, { action: "freeze" });
    expect(sent[0]).toEqual({ type: "hotWidgetsControl", action: "freeze" });
  });

  it("pulseflow_hot_widgets rejects an invalid action", async () => {
    const { ctx, sent } = fakeContext();
    const res = await findTool("pulseflow_hot_widgets")!.handler(ctx, { action: "nope" });
    expect(res.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("snapshots a baseline and compares it after a fix", async () => {
    const state = scripted();
    const { ctx } = fakeContext(state);

    const saved = await findTool("pulseflow_snapshot")!.handler(ctx, { label: "before" });
    expect(saved.content[0].text).toContain('Saved baseline "before"');

    // Simulate a fix: calm frames, no hot rebuilds, no errors.
    state.hot = null;
    state.hotAvailable = true;
    state.points = [point({ buildMs: 5, rasterMs: 5, frameMs: 10, jank: 0 })];
    state.appErrors = [];
    state.rebuildCauses = null;
    await findTool("pulseflow_snapshot")!.handler(ctx, { label: "after" });

    const res = await findTool("pulseflow_compare")!.handler(ctx, {
      before: "before",
      after: "after",
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("PulseFlow compare");
    expect(res.content[0].text).toContain("## Metrics");
    expect(res.content[0].text).toMatch(/Fixed|Still open/);
  });

  it("pulseflow_compare flags unknown baselines", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_compare")!.handler(ctx, { before: "x", after: "y" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown baseline/);
  });

  it("pulseflow_snapshot requires a label", async () => {
    const { ctx } = fakeContext();
    const res = await findTool("pulseflow_snapshot")!.handler(ctx, {});
    expect(res.isError).toBe(true);
  });

  it("pulseflow_memory around_scenario captures, runs, and diffs", async () => {
    const state = scripted();
    const sent: unknown[] = [];
    const responses: BridgeServerMessage[] = [
      { type: "memoryProfile", available: true, snapshot: { id: "s1", t: 1, heapMb: 100, externalMb: 8, classes: [] } },
      { type: "scenarioStatus", running: null, result: { id: "listFlood", ok: true } },
      { type: "memoryProfile", available: true, snapshot: { id: "s2", t: 2, heapMb: 140, externalMb: 8, classes: [] } },
      {
        type: "memoryProfile",
        available: true,
        diff: { fromId: "s1", toId: "s2", grew: [{ className: "Invoice", instancesDelta: 40, bytesDelta: 2 * 1024 * 1024 }] },
      },
    ];
    const ctx: ToolContext = {
      state,
      snapshots: new Map(),
      send: (m) => sent.push(m),
      waitFor: vi.fn(async () => {
        const m = responses.shift() ?? null;
        if (m) applyMessage(state, m);
        return m;
      }),
      writeFile: (n) => `/tmp/${n}`,
      log: () => {},
    };

    const res = await findTool("pulseflow_memory")!.handler(ctx, {
      action: "around_scenario",
      scenario: "listFlood",
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.message).toContain("listFlood");
    expect(payload.message).toContain("ok");
    expect(payload.grew[0].className).toBe("Invoice");

    // Orchestration: capture, run scenario, capture, diff.
    expect(sent[0]).toEqual({ type: "memorySnapshot", action: "capture" });
    expect(sent[1]).toEqual({ type: "scenario", action: "run", id: "listFlood" });
    expect(sent[2]).toEqual({ type: "memorySnapshot", action: "capture" });
    expect(sent[3]).toEqual({ type: "memorySnapshot", action: "diff" });
  });

  it("pulseflow_memory around_scenario requires a scenario id", async () => {
    const { ctx, sent } = fakeContext();
    const res = await findTool("pulseflow_memory")!.handler(ctx, { action: "around_scenario" });
    expect(res.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
