import { describe, expect, it, vi } from "vitest";
import {
  applyMessage,
  createSessionState,
  focusedStateOf,
  resetTelemetry,
  type McpSessionState,
} from "@/lib/mcp/session-state";
import { findTool, type ToolContext } from "@/lib/mcp/tools";
import type { BridgeServerMessage, MetricPoint } from "@/lib/types";

function point(t: number, buildMs = 6): MetricPoint {
  return {
    t,
    cpu: 40,
    framePressure: 40,
    frameMs: 15,
    buildMs,
    rasterMs: 8,
    vsyncMs: 0,
    jank: 0,
    heapMb: 100,
    externalMb: 8,
  };
}

/** Session starting at t=0 with one sample every 1s for `count` seconds. */
function sessionWith(count: number, buildMsAt: (i: number) => number = () => 6): McpSessionState {
  const state = createSessionState();
  for (let i = 0; i < count; i++) {
    applyMessage(state, { type: "metrics", point: point(i * 1000, buildMsAt(i)) } as BridgeServerMessage);
  }
  return state;
}

function ctxFor(state: McpSessionState): { ctx: ToolContext; sent: unknown[] } {
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

describe("focusedStateOf", () => {
  it("anchors warmup to the session start, not the rolling buffer head", () => {
    // 300 samples into a 240-sample buffer → head is t=60s, but the session started at t=0.
    const state = sessionWith(300);
    expect(state.points[0].t).toBe(60_000);
    expect(state.sessionStartT).toBe(0);

    const { state: focused, info } = focusedStateOf(state, { excludeFirstSec: 10 });
    expect(focused.points[0].t).toBe(60_000);
    expect(info.samplesTotal).toBe(240);
    expect(info.samplesKept).toBe(240);

    // Warmup 100s drops the samples before t=100s.
    const late = focusedStateOf(state, { excludeFirstSec: 100 });
    expect(late.info.samplesKept).toBe(200);
    expect(late.state.points[0].t).toBe(100_000);
  });

  it("windowMs keeps only the most recent samples", () => {
    const state = sessionWith(30);
    const { info, state: focused } = focusedStateOf(state, { windowMs: 5_000 });
    expect(info.samplesKept).toBe(6);
    expect(focused.points.at(-1)!.t).toBe(29_000);
  });

  it("route focus filters stalls and recomputes totals", () => {
    const state = sessionWith(3);
    applyMessage(state, {
      type: "stalls",
      available: true,
      total: 3,
      maxDurationMs: 900,
      stalls: [
        { id: "a", durationMs: 900, atMs: 1, route: "/Cold" },
        { id: "b", durationMs: 300, atMs: 2, route: "/MainPage" },
        { id: "c", durationMs: 200, atMs: 3, route: "/MainPage" },
      ],
    } as BridgeServerMessage);

    const { state: focused } = focusedStateOf(state, { route: "/MainPage" });
    expect(focused.stalls?.stalls.map((s) => s.id)).toEqual(["b", "c"]);
    expect(focused.stalls?.total).toBe(2);
    expect(focused.stalls?.maxDurationMs).toBe(300);

    // Unfocused stays untouched.
    expect(focusedStateOf(state).state.stalls?.total).toBe(3);
  });

  it("with no filters returns the same samples", () => {
    const state = sessionWith(10);
    const { info } = focusedStateOf(state);
    expect(info).toEqual({
      route: null,
      excludeFirstSec: 0,
      windowMs: null,
      samplesTotal: 10,
      samplesKept: 10,
    });
  });
});

describe("focus tools", () => {
  it("pulseflow_frames applies warmup and reports the focus it used", async () => {
    const { ctx } = ctxFor(sessionWith(100));
    const res = await findTool("pulseflow_frames")!.handler(ctx, { excludeFirstSec: 50 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.focus.excludeFirstSec).toBe(50);
    expect(payload.focus.samplesKept).toBe(50);
  });

  it("pulseflow_focus_snapshot ignores cold-start jank once excluded", async () => {
    // First 10 samples are janky cold start (build 40ms), the rest are fine (6ms).
    const state = sessionWith(60, (i) => (i < 10 ? 40 : 6));
    const { ctx } = ctxFor(state);
    const all = JSON.parse((await findTool("pulseflow_focus_snapshot")!.handler(ctx, {})).content[0].text);
    const warm = JSON.parse(
      (await findTool("pulseflow_focus_snapshot")!.handler(ctx, { excludeFirstSec: 10 })).content[0].text,
    );
    expect(warm.focus.samplesKept).toBe(50);
    expect(warm.stats.p95BuildMs).toBeLessThan(all.stats.p95BuildMs);
  });

  it("pulseflow_reset_telemetry clears samples and re-anchors the warmup clock", async () => {
    const state = sessionWith(20);
    const { ctx, sent } = ctxFor(state);
    await findTool("pulseflow_reset_telemetry")!.handler(ctx, {});
    expect(state.points).toHaveLength(0);
    expect(state.sessionStartT).toBeNull();
    expect(sent).toHaveLength(0);

    applyMessage(state, { type: "metrics", point: point(99_000) } as BridgeServerMessage);
    expect(state.sessionStartT).toBe(99_000);
  });

  it("pulseflow_reset_telemetry hot:true sends a hot widget reset", async () => {
    const { ctx, sent } = ctxFor(sessionWith(3));
    await findTool("pulseflow_reset_telemetry")!.handler(ctx, { hot: true });
    expect(sent).toEqual([{ type: "hotWidgetsControl", action: "reset" }]);
  });

  it("pulseflow_disconnect clears telemetry", async () => {
    const state = sessionWith(5);
    const { ctx, sent } = ctxFor(state);
    await findTool("pulseflow_disconnect")!.handler(ctx, {});
    expect(sent).toEqual([{ type: "disconnect" }]);
    expect(state.points).toHaveLength(0);
    expect(state.sessionStartT).toBeNull();
  });

  it("stalls reset stays hidden when the app re-sends its old buffer", () => {
    const state = sessionWith(3);
    const oldStalls = [
      { id: "old-1", durationMs: 900, atMs: 1, route: "/Cold" },
      { id: "old-2", durationMs: 400, atMs: 2, route: "/Cold" },
    ];
    applyMessage(state, { type: "stalls", available: true, total: 2, maxDurationMs: 900, stalls: oldStalls } as BridgeServerMessage);
    expect(state.stalls?.total).toBe(2);

    resetTelemetry(state);
    expect(state.stalls).toBeNull();

    // App keeps its buffer and adds one new stall after the reset.
    applyMessage(state, {
      type: "stalls",
      available: true,
      total: 3,
      maxDurationMs: 900,
      stalls: [...oldStalls, { id: "new-1", durationMs: 120, atMs: 5, route: "/MainPage" }],
    } as BridgeServerMessage);

    expect(state.stalls?.stalls.map((s) => s.id)).toEqual(["new-1"]);
    expect(state.stalls?.total).toBe(1);
    expect(state.stalls?.maxDurationMs).toBe(120);
  });

  it("pulseflow_problems, pulseflow_report and pulseflow_widgets accept focus args", async () => {
    const { ctx } = ctxFor(sessionWith(100));
    const problems = await findTool("pulseflow_problems")!.handler(ctx, { excludeFirstSec: 20 });
    expect(problems.isError).toBeFalsy();
    expect(problems.content[0].text).toContain("PulseFlow problems");

    const report = await findTool("pulseflow_report")!.handler(ctx, { route: "/MainPage", excludeFirstSec: 20 });
    expect(report.isError).toBeFalsy();

    const widgets = await findTool("pulseflow_widgets")!.handler(ctx, { route: "/MainPage" });
    expect(JSON.parse(widgets.content[0].text).available).toBe(false);
  });

  it("pulseflow_connect starts a fresh session", async () => {
    const state = sessionWith(5);
    const { ctx } = ctxFor(state);
    await findTool("pulseflow_connect")!.handler(ctx, { url: "ws://127.0.0.1:8181/ws" });
    expect(state.points).toHaveLength(0);
    expect(state.sessionStartT).toBeNull();
  });
});
