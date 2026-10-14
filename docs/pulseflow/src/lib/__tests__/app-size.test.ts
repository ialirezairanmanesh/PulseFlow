import { describe, expect, it } from "vitest";
import { analyzeAppSize, diffAppSize, parseSizeAnalysisJson } from "@/lib/app-size";
import { findTool, type ToolContext } from "@/lib/mcp/tools";
import { createSessionState } from "@/lib/mcp/session-state";

/** Minimal Flutter-like --analyze-size tree. */
const SAMPLE = {
  n: "app-release.apk",
  value: 10_000_000,
  type: "apk",
  children: [
    {
      n: "lib/",
      value: 7_000_000,
      children: [
        {
          n: "arm64-v8a/libapp.so",
          value: 5_000_000,
          children: [
            {
              n: "package:my_app",
              value: 1_200_000,
              children: [{ n: "main.dart", value: 400_000 }],
            },
            { n: "package:huge_sdk", value: 2_500_000 },
            { n: "package:flutter", value: 800_000 },
          ],
        },
        { n: "arm64-v8a/libflutter.so", value: 2_000_000 },
      ],
    },
    {
      n: "assets/",
      value: 2_500_000,
      children: [
        { n: "flutter_assets", value: 2_500_000, children: [
          { n: "assets/hero.png", value: 1_800_000 },
          { n: "fonts/BigFont.ttf", value: 600_000 },
        ]},
      ],
    },
    { n: "META-INF/", value: 500_000 },
  ],
};

describe("app-size", () => {
  it("parses a Flutter size-analysis tree", () => {
    const root = parseSizeAnalysisJson(SAMPLE);
    expect(root.name).toBe("app-release.apk");
    expect(root.type).toBe("apk");
    expect(root.bytes).toBe(10_000_000);
  });

  it("ranks packages and assets for shrink targets", () => {
    const report = analyzeAppSize(SAMPLE);
    expect(report.totalBytes).toBe(10_000_000);
    expect(report.packages[0]?.name).toBe("package:huge_sdk");
    expect(report.packages.find((p) => p.name === "package:my_app")?.bytes).toBe(1_200_000);
    expect(report.assets[0]?.name).toMatch(/hero\.png/);
    expect(report.tips.some((t) => /huge_sdk|hero|WebP|font/i.test(t))).toBe(true);
    expect(report.categories[0]?.name).toBe("lib/");
  });

  it("diffs before/after analyses", () => {
    const before = analyzeAppSize(SAMPLE);
    const afterRaw = structuredClone(SAMPLE);
    (afterRaw.children[1] as { children: Array<{ children: Array<{ value: number }> }> }).children[0].children[0].value = 900_000;
    afterRaw.value = 9_100_000;
    const after = analyzeAppSize(afterRaw);
    const diff = diffAppSize(before, after);
    expect(diff.deltaBytes).toBeLessThan(0);
    expect(diff.shrank.some((r) => /hero/i.test(r.name))).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(() => analyzeAppSize({ foo: 1 })).toThrow(/size-analysis/i);
  });
});

describe("pulseflow_app_size MCP", () => {
  it("returns ranked packages from inline json", async () => {
    const ctx: ToolContext = {
      state: createSessionState(),
      snapshots: new Map(),
      send: () => {},
      waitFor: async () => null,
      writeFile: (n) => `/tmp/${n}`,
      log: () => {},
    };
    const res = await findTool("pulseflow_app_size")!.handler(ctx, {
      json: JSON.stringify(SAMPLE),
      limit: 5,
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload.packages[0].name).toBe("package:huge_sdk");
    expect(payload.totalBytes).toBe(10_000_000);
    expect(payload.tips.length).toBeGreaterThan(0);
  });
});
