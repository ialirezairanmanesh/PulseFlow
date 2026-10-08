import { describe, expect, it } from "vitest";
import {
  buildChatMessages,
  buildSectionContext,
  sectionFromPath,
  type AiContextState,
} from "@/lib/ai-context";
import { buildProblems } from "@/lib/problems";
import type { NetworkRequest } from "@/lib/types";
import { hotPayload, point, widget } from "./helpers";

function slowPost(uri = "https://api.fidadev.ir/v6/invoice", latencyMs = 3450): NetworkRequest {
  return {
    id: "1",
    t: 0,
    method: "POST",
    uri,
    latencyMs,
    requestBytes: 100,
    responseBytes: 200,
    status: 200,
  };
}

function state(overrides: Partial<AiContextState> = {}): AiContextState {
  const problems =
    overrides.problems ??
    buildProblems({
      hot: hotPayload([widget({ name: "InvoiceCard", ratePerSec: 22, share: 40 })]),
      hotAvailable: true,
      gcEvents: [],
    });
  return { points: [point({ buildMs: 20 })], problems, ...overrides };
}

function mixedState() {
  const hot = hotPayload(
    [widget({ name: "InvoiceCard", route: "/invoice/create", ratePerSec: 22, share: 40 })],
    { currentRoute: "/invoice/create" },
  );
  const network = [slowPost()];
  const memoryDiff = {
    fromId: "a",
    toId: "b",
    grew: [{ className: "InvoiceCache", bytesDelta: 2 * 1024 * 1024, instancesDelta: 40 }],
  };
  const problems = buildProblems({
    hot,
    hotAvailable: true,
    gcEvents: [],
    network,
    memoryDiff,
  });
  return state({ hot, problems, network, memoryDiff });
}

describe("sectionFromPath", () => {
  it("maps routes to sections", () => {
    expect(sectionFromPath("/cpu")).toBe("cpu");
    expect(sectionFromPath("/memory/")).toBe("memory");
    expect(sectionFromPath("/network")).toBe("network");
    expect(sectionFromPath("/problems")).toBe("problems");
    expect(sectionFromPath("/device")).toBe("device");
  });

  it("defaults unknown paths to problems", () => {
    expect(sectionFromPath("/unknown")).toBe("problems");
  });
});

describe("buildSectionContext", () => {
  it("includes the verdict and the top problem", () => {
    const context = buildSectionContext("problems", state());
    expect(context).toContain("Session health");
    expect(context).toContain("InvoiceCard");
    expect(context).toContain("frame-budget track");
    expect(context).toContain("latency track");
    expect(context).toContain("Device context");
    expect(context).toContain("UI stalls");
    expect(context).not.toContain("NaN");
  });

  it("includes device + stalls on the device section", () => {
    const context = buildSectionContext(
      "device",
      state({
        deviceContext: {
          available: true,
          platform: "android",
          buildMode: "profile",
          locale: "fa-IR",
          textScale: 1.1,
          appPackage: "com.example.app",
          display: { refreshRate: 120, budgetMs: 8.33, devicePixelRatio: 3 },
        },
        stalls: {
          available: true,
          thresholdMs: 250,
          total: 2,
          maxDurationMs: 600,
          stalls: [{ id: "s1", durationMs: 600, atMs: 1, route: "/home" }],
        },
        problems: buildProblems({
          hot: null,
          hotAvailable: true,
          gcEvents: [],
          stalls: {
            available: true,
            thresholdMs: 250,
            total: 2,
            maxDurationMs: 600,
            stalls: [{ id: "s1", durationMs: 600, atMs: 1, route: "/home" }],
          },
        }),
      }),
    );
    expect(context).toContain("android");
    expect(context).toContain("120 Hz");
    expect(context).toContain("600");
    expect(context).toMatch(/UI freeze|main-isolate stall/i);
  });

  it("summarises frame timing and still attaches widget/route evidence", () => {
    const context = buildSectionContext(
      "frames",
      state({
        hot: hotPayload([
          widget({ name: "InvoiceCard", route: "/invoices", ratePerSec: 22, share: 40 }),
        ]),
      }),
    );
    expect(context).toContain("P95 build");
    expect(context).toContain("InvoiceCard");
    expect(context).toContain("/invoices");
    expect(context).toContain("Frame budget health");
  });

  it("degrades gracefully with no data", () => {
    const context = buildSectionContext("cpu", state({ problems: [], points: [] }));
    expect(context).toContain("no CPU profile");
    expect(context).not.toContain("NaN");
  });

  it("reuses the full agent report for the report section", () => {
    const context = buildSectionContext("report", state());
    expect(context).toContain("PulseFlow agent report");
  });

  it("names widgets with route and source in the widgets section", () => {
    const hot = hotPayload(
      [
        widget({
          name: "InvoiceCard",
          route: "/invoices",
          ratePerSec: 22,
          share: 40,
          sourceUri: "package:app/invoice.dart",
          sourceLine: 42,
          cause: "InvoiceList",
        }),
      ],
      { currentRoute: "/invoices" },
    );
    const problems = buildProblems({ hot, hotAvailable: true, gcEvents: [] });
    const context = buildSectionContext("widgets", state({ hot, problems }));
    expect(context).toContain("`InvoiceCard` on /invoices");
    expect(context).toContain("package:app/invoice.dart:42");
    expect(context).toContain("cause InvoiceList");
    expect(context).toContain("Widget problems on this screen");
    expect(context).toContain("Current route/screen: **/invoices**");
  });

  it("scopes the widgets AI brief to the current route", () => {
    const hot = hotPayload(
      [
        widget({
          name: "InvoiceCard",
          route: "/invoices",
          ratePerSec: 22,
          share: 40,
        }),
        widget({
          name: "SettingsTile",
          route: "/settings",
          ratePerSec: 30,
          share: 50,
        }),
      ],
      { currentRoute: "/invoices" },
    );
    const problems = buildProblems({ hot, hotAvailable: true, gcEvents: [] });
    const context = buildSectionContext("widgets", state({ hot, problems }));
    expect(context).toContain("InvoiceCard");
    expect(context).not.toContain("SettingsTile");
  });

  it("keeps Slow HTTP out of the widgets AI brief and verdict", () => {
    const hot = hotPayload(
      [widget({ name: "InvoiceCard", route: "/invoice/create", ratePerSec: 0.2, share: 1 })],
      { currentRoute: "/invoice/create" },
    );
    const network = [slowPost()];
    const problems = buildProblems({
      hot,
      hotAvailable: true,
      gcEvents: [],
      network,
    });
    expect(problems.some((p) => p.kind === "slow_http")).toBe(true);
    const context = buildSectionContext("widgets", state({ hot, problems, network }));
    expect(context).toContain("Widget rebuild health");
    expect(context).toContain("Out of scope here");
    expect(context).not.toContain("Slow HTTP");
    expect(context).not.toContain("/v6/invoice");
    expect(context).not.toContain("3450");
  });

  it("scopes each specialized tab to its own track", () => {
    const s = mixedState();
    expect(s.problems.some((p) => p.kind === "slow_http")).toBe(true);
    expect(s.problems.some((p) => p.kind === "memory_growth")).toBe(true);

    const network = buildSectionContext("network", s);
    expect(network).toContain("Network / latency health");
    expect(network).toContain("/v6/invoice");
    expect(network).toContain("3450");
    expect(network).not.toContain("InvoiceCard");
    expect(network).not.toContain("InvoiceCache");
    expect(network).not.toContain("P95 build");

    const memory = buildSectionContext("memory", s);
    expect(memory).toContain("Memory health");
    expect(memory).toContain("InvoiceCache");
    expect(memory).not.toContain("/v6/invoice");
    expect(memory).not.toContain("InvoiceCard");
    expect(memory).not.toContain("P95 build");

    const frames = buildSectionContext("frames", s);
    expect(frames).toContain("Frame budget health");
    expect(frames).toContain("P95 build");
    expect(frames).toContain("InvoiceCard");
    expect(frames).not.toContain("/v6/invoice");
    expect(frames).not.toContain("InvoiceCache");

    const widgets = buildSectionContext("widgets", s);
    expect(widgets).toContain("InvoiceCard");
    expect(widgets).not.toContain("/v6/invoice");
    expect(widgets).not.toContain("InvoiceCache");
  });
});

describe("buildChatMessages", () => {
  it("prepends a system prompt and honours the language", () => {
    const messages = buildChatMessages("problems", "DATA", "why?", "en");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("professional English");
    expect(messages[0].content).toContain("## Findings");
    expect(messages[0].content).toContain("never stop mid-sentence");
    expect(messages[1].content).toContain("DATA");
    expect(messages[1].content).toContain("why?");
  });

  it("uses a network-focused default on the network section", () => {
    const messages = buildChatMessages("network", "DATA", undefined, "en");
    expect(messages[1].content).toMatch(/Network view|HTTP latency/i);
    expect(messages[0].content).toMatch(/Network tab/i);
    expect(messages[0].content).toMatch(/Do not review widget rebuilds/i);
  });

  it("uses a widget-problem-focused default on the widgets section", () => {
    const messages = buildChatMessages("widgets", "DATA", undefined, "en");
    expect(messages[1].content).toMatch(/rebuild|quiet for rebuilds/i);
    expect(messages[0].content).toMatch(/Widgets tab/i);
    expect(messages[0].content).toMatch(/Do not discuss Slow HTTP/i);
  });

  it("keeps the system prompt disciplined about causality and caps", () => {
    const messages = buildChatMessages("problems", "DATA", undefined, "en");
    expect(messages[0].content).toMatch(/frame-budget/i);
    expect(messages[0].content).toMatch(/Findings at 5/i);
    expect(messages[0].content).toMatch(/never invent/i);
    expect(messages[0].content).toMatch(/scroll\/list/i);
  });

  it("omits near-idle app widgets from the problems AI brief", () => {
    const context = buildSectionContext(
      "problems",
      state({
        hot: hotPayload([
          widget({ name: "InvoiceTableDisplayItem", ratePerSec: 0.1, share: 1 }),
          widget({ name: "HotCard", ratePerSec: 22, share: 40 }),
        ]),
      }),
    );
    expect(context).toContain("HotCard");
    expect(context).not.toContain("InvoiceTableDisplayItem");
  });

  it("keeps prior turns between the system prompt and the new question", () => {
    const messages = buildChatMessages("problems", "DATA", "again", "fa", [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ]);
    expect(messages).toHaveLength(4);
    expect(messages[1].content).toBe("first");
    expect(messages[2].content).toBe("answer");
  });
});
