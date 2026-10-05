import { describe, expect, it } from "vitest";
import { isFrameworkWidget, isFrameworkWidgetName } from "@/lib/framework-widget";

describe("isFrameworkWidgetName", () => {
  it("flags exact Flutter shells", () => {
    expect(isFrameworkWidgetName("Padding")).toBe(true);
    expect(isFrameworkWidgetName("CustomScrollView")).toBe(true);
    expect(isFrameworkWidgetName("DefaultSelectionStyle")).toBe(true);
    expect(isFrameworkWidgetName("InvoiceTable")).toBe(false);
  });

  it("flags private Element wrappers", () => {
    expect(isFrameworkWidgetName("_FocusInheritedScope")).toBe(true);
    expect(isFrameworkWidgetName("_InkResponseStateWidget")).toBe(true);
    expect(isFrameworkWidgetName("_ActionsScope")).toBe(true);
  });

  it("flags Animated* and *Transition shells", () => {
    expect(isFrameworkWidgetName("AnimatedDefaultTextStyle")).toBe(true);
    expect(isFrameworkWidgetName("AnimatedPhysicalModel")).toBe(true);
    expect(isFrameworkWidgetName("ScaleTransition")).toBe(true);
    expect(isFrameworkWidgetName("SvgPicture")).toBe(true);
  });

  it("leaves app widgets alone", () => {
    expect(isFrameworkWidgetName("InvoiceTable")).toBe(false);
    expect(isFrameworkWidgetName("TabCubitScope")).toBe(false);
  });
});

describe("isFrameworkWidget", () => {
  it("honours the payload flag and the name heuristic", () => {
    expect(isFrameworkWidget({ name: "Card", isFramework: true })).toBe(true);
    expect(isFrameworkWidget({ name: "_ParentInkResponseProvider" })).toBe(true);
    expect(isFrameworkWidget({ name: "InvoiceCard" })).toBe(false);
  });
});
