import { describe, expect, it } from "vitest";
import {
  buildChatMessages,
  buildSectionContext,
  sectionFromPath,
  type AiContextState,
} from "@/lib/ai-context";
import { buildProblems } from "@/lib/problems";
import { hotPayload, point, widget } from "./helpers";

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

describe("sectionFromPath", () => {
  it("maps routes to sections", () => {
    expect(sectionFromPath("/cpu")).toBe("cpu");
    expect(sectionFromPath("/memory/")).toBe("memory");
    expect(sectionFromPath("/network")).toBe("network");
    expect(sectionFromPath("/problems")).toBe("problems");
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
    expect(context).not.toContain("NaN");
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
    const context = buildSectionContext(
      "widgets",
      state({
        hot: hotPayload([
          widget({
            name: "InvoiceCard",
            route: "/invoices",
            ratePerSec: 22,
            share: 40,
            sourceUri: "package:app/invoice.dart",
            sourceLine: 42,
            cause: "InvoiceList",
          }),
        ]),
      }),
    );
    expect(context).toContain("`InvoiceCard` on /invoices");
    expect(context).toContain("package:app/invoice.dart:42");
    expect(context).toContain("cause InvoiceList");
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

  it("uses a default instruction when no question is given", () => {
    const messages = buildChatMessages("network", "DATA");
    expect(messages[1].content).toMatch(/concise|accurate/i);
    expect(messages[1].content).toContain("widget");
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
