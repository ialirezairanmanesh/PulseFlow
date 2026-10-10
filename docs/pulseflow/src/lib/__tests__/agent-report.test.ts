import { describe, expect, it } from "vitest";
import { AGENT_PROMPT, buildAgentReportJson, buildAgentReportMarkdown } from "@/lib/agent-report";
import type { AgentReportInput } from "@/lib/agent-report";
import type { PerformanceProblem } from "@/lib/types";

const problem: PerformanceProblem = {
  id: "hot_rebuild:x",
  severity: "high",
  kind: "hot_rebuild",
  title: "InvoiceCard rebuilds heavily",
  detail: "20.0/s — triggered by InvoiceListState",
  action: "Isolate setState",
  sourceUri: "/abs/card.dart",
  sourceLine: 42,
};

const input: AgentReportInput = {
  capturedAt: 1_700_000_000_000,
  mode: "live",
  isolateName: "main",
  refreshRate: 120,
  budgetMs: 8.33,
  problems: [problem],
  rebuildRoots: [
    {
      id: "r|InvoiceListState|",
      widget: "InvoiceListState",
      route: "/invoices",
      cause: "self",
      rebuilds: 36,
      ratePerSec: 3.6,
      children: 2,
    },
  ],
  errors: [{ kind: "overflow", signature: "RenderFlex overflowed", count: 2, route: "/invoices", top: ["#0 RenderFlex.performLayout"] }],
  imageStats: {
    available: true,
    cache: { currentSizeBytes: 1024, currentSize: 1, maximumSizeBytes: 2048, live: 1, pending: 0 },
    oversized: [
      { source: "assets/hero.png", decodedBytes: 4194304, displayBytes: 65536, overheadBytes: 4128768, count: 12 },
    ],
  },
  cpuProfile: {
    durationMs: 5000,
    sampleCount: 100,
    samplePeriodMicros: 1000,
    capturedAt: 0,
    flameRoot: { name: "root", value: 1 },
    topFunctions: [
      { name: "build", qualifiedName: "AppState.build", selfMs: 1, totalMs: 2, selfPercent: 22, totalPercent: 45 },
    ],
  },
  network: [{ id: "n", t: 0, method: "GET", uri: "/api/slow", latencyMs: 900, requestBytes: 1, responseBytes: 2, status: 200 }],
  stats: { problemCount: 1, p95BuildMs: 9.5, p95RasterMs: 4, p95FrameMs: 14, rebuildRate: 20, heapMb: 52, jankRatio: 0.25 },
  baselines: [],
};

describe("buildAgentReportMarkdown", () => {
  it("starts with the agent prompt and includes every section", () => {
    const md = buildAgentReportMarkdown(input);
    expect(md).toContain(AGENT_PROMPT);
    expect(md).toContain("## Problems (ranked)");
    expect(md).toContain("## Rebuild roots");
    expect(md).toContain("## Errors");
    expect(md).toContain("## Oversized images");
    expect(md).toContain("## CPU hotspots");
    expect(md).toContain("## Slow HTTP");
  });

  it("includes source locations and 120 Hz budget", () => {
    const md = buildAgentReportMarkdown(input);
    expect(md).toContain("/abs/card.dart:42");
    expect(md).toContain("120 Hz");
  });

  it("surfaces impact and the plain-language why", () => {
    const md = buildAgentReportMarkdown({
      ...input,
      problems: [{ ...problem, impact: 82, why: "Because ListState rebuilds, Card rebuilds 22/s." }],
    });
    expect(md).toContain("impact 82");
    expect(md).toContain("Why: Because ListState rebuilds");
  });

  it("explains profile-mode gaps in the coverage section", () => {
    const md = buildAgentReportMarkdown({
      ...input,
      buildInfo: {
        buildMode: "profile",
        probes: { rebuildProbe: false, sourceLocations: false, leaks: false, errors: true, images: true },
      },
      cpuProfile: null,
    });
    expect(md).toContain("## Coverage / missing data");
    expect(md).toContain("Build mode: **profile**");
    expect(md).toContain("needs a Debug build");
    expect(md).toContain("No CPU profile captured");
  });

  it("always prints image cache health when available", () => {
    const md = buildAgentReportMarkdown({
      ...input,
      imageStats: {
        available: true,
        cache: { currentSizeBytes: 1024, currentSize: 3, maximumSizeBytes: 2048, live: 1, pending: 0 },
        oversized: [],
      },
    });
    expect(md).toContain("## Image cache");
    expect(md).not.toContain("## Oversized images");
  });
});

describe("actionable agent prompt", () => {
  it("asks for an execution-ready plan with target/evidence/change/verify", () => {
    expect(AGENT_PROMPT).toMatch(/execution-ready fix plan/);
    expect(AGENT_PROMPT).toMatch(/file:line/);
    expect(AGENT_PROMPT).toMatch(/before→after snippet/);
    expect(AGENT_PROMPT).toMatch(/Verify/);
  });

  it("embeds an explicit output-format contract in the report", () => {
    const md = buildAgentReportMarkdown(input);
    expect(md).toContain("## Output format (follow exactly)");
    expect(md).toContain("**Target**");
    expect(md).toContain("**Change**");
  });

  it("names the widget, route, and measured evidence for each problem", () => {
    const md = buildAgentReportMarkdown({
      ...input,
      problems: [
        {
          ...problem,
          widget: "InvoiceCard",
          route: "/invoices",
          ratePerSec: 22,
          share: 40,
          cause: "InvoiceListState",
          impact: 78,
        },
      ],
    });
    expect(md).toContain("`InvoiceCard` on /invoices");
    expect(md).toContain("22.0/s");
    expect(md).toContain("40.0% share");
    expect(md).toContain("cause: InvoiceListState");
    expect(md).toContain("/abs/card.dart:42");
  });
});

describe("buildAgentReportJson", () => {
  it("carries the structured payload with caps", () => {
    const json = buildAgentReportJson(input);
    expect(json.kind).toBe("agent-report");
    expect(json.problems).toHaveLength(1);
    expect(json.rebuildRoots).toHaveLength(1);
    expect(json.slowHttp[0].uri).toBe("/api/slow");
  });
});
