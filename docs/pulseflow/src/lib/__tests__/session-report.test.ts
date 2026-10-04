import { describe, expect, it } from "vitest";
import {
  buildSessionReportJson,
  buildSessionReportMarkdown,
  type SessionReportInput,
} from "@/lib/session-report";
import type { PerformanceProblem } from "@/lib/types";

const problem: PerformanceProblem = {
  id: "high_build",
  severity: "high",
  kind: "high_build",
  title: "Build time is over budget",
  detail: "Latest Build 14.0 ms",
  action: "Split large widgets",
};

const input: SessionReportInput = {
  capturedAt: 1_700_000_000_000,
  mode: "mock",
  isolateName: "main",
  problems: [problem],
  network: [
    {
      id: "n1",
      t: 0,
      method: "GET",
      uri: "/api/slow",
      latencyMs: 900,
      requestBytes: 10,
      responseBytes: 20,
      status: 200,
    },
  ],
  leaks: [
    { className: "Image", count: 2 },
    { className: "AnimationController", count: 1 },
  ],
  baselines: [],
};

describe("session report", () => {
  it("includes leaks in the JSON payload", () => {
    const json = buildSessionReportJson(input);
    expect(json.leaks).toHaveLength(2);
    expect(json.problems).toHaveLength(1);
  });

  it("renders a leaks section in Markdown", () => {
    const md = buildSessionReportMarkdown(input);
    expect(md).toContain("## Leaks");
    expect(md).toContain("Image");
    expect(md).toContain("2 outstanding");
  });

  it("renders the problem and HTTP sections", () => {
    const md = buildSessionReportMarkdown(input);
    expect(md).toContain("HIGH");
    expect(md).toContain("/api/slow");
  });
});
