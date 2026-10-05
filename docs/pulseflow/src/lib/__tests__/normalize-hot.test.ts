import { describe, expect, it } from "vitest";
import { normalizeHotWidgetsMessage } from "@/lib/normalize-hot";
import type { BridgeHotWidgetsMessage } from "@/lib/types";

describe("normalizeHotWidgetsMessage", () => {
  it("normalizes a legacy payload with rebuilds and no ids", () => {
    const legacy = {
      type: "hotWidgets",
      available: true,
      windowMs: 0,
      widgets: [{ name: "Card", rebuilds: 20, share: 50 }],
    } as unknown as BridgeHotWidgetsMessage;

    const out = normalizeHotWidgetsMessage(legacy);
    expect(out.windowMs).toBe(10000);
    expect(out.widgets).toHaveLength(1);
    expect(out.widgets[0].rebuildsWindow).toBe(20);
    expect(out.widgets[0].rebuildsSession).toBe(20);
    expect(out.widgets[0].id).toBe("(unnamed)|Card|");
    expect(out.widgets[0].ratePerSec).toBeCloseTo(2, 5);
    expect(out.totalRebuildsWindow).toBe(20);
  });

  it("derives screens by route when absent", () => {
    const legacy = {
      type: "hotWidgets",
      available: true,
      windowMs: 10000,
      widgets: [
        { name: "A", route: "/a", rebuildsWindow: 10 },
        { name: "B", route: "/a", rebuildsWindow: 5 },
        { name: "C", route: "/b", rebuildsWindow: 2 },
      ],
    } as unknown as BridgeHotWidgetsMessage;

    const out = normalizeHotWidgetsMessage(legacy);
    expect(out.screens).toHaveLength(2);
    expect(out.screens[0].route).toBe("/a");
    expect(out.screens[0].rebuildsWindow).toBe(15);
  });

  it("keeps source locations and recomputes a missing share", () => {
    const msg = {
      type: "hotWidgets",
      available: true,
      windowMs: 10000,
      totalRebuildsWindow: 20,
      currentRoute: "/invoices",
      widgets: [
        {
          name: "InvoiceCard",
          route: "/invoices",
          rebuildsWindow: 10,
          share: 0,
          sourceUri: "package:app/invoice.dart",
          sourceLine: 42,
        },
      ],
    } as unknown as BridgeHotWidgetsMessage;

    const out = normalizeHotWidgetsMessage(msg);
    expect(out.currentRoute).toBe("/invoices");
    expect(out.widgets[0].share).toBe(50);
    expect(out.widgets[0].sourceUri).toBe("package:app/invoice.dart");
    expect(out.widgets[0].sourceLine).toBe(42);
  });

  it("marks private Flutter shells as framework even without the wire flag", () => {
    const msg = {
      type: "hotWidgets",
      available: true,
      windowMs: 10000,
      widgets: [{ name: "_FocusInheritedScope", route: "/a", rebuildsWindow: 10 }],
    } as unknown as BridgeHotWidgetsMessage;

    const out = normalizeHotWidgetsMessage(msg);
    expect(out.widgets[0].isFramework).toBe(true);
  });
});
