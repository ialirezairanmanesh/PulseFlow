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
});
