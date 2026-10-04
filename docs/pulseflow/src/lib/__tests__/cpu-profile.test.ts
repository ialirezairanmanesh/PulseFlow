import { describe, expect, it } from "vitest";
import { isAppCpuFrame, tipForCpuHotspot } from "@/lib/cpu-profile";
import type { CpuFunctionStat } from "@/lib/types";

function fn(qualifiedName: string): CpuFunctionStat {
  return {
    name: qualifiedName.split(".").pop() ?? qualifiedName,
    qualifiedName,
    selfMs: 1,
    totalMs: 1,
    selfPercent: 10,
    totalPercent: 10,
  };
}

describe("isAppCpuFrame", () => {
  it("treats framework and vm frames as non-app", () => {
    expect(isAppCpuFrame("dart:math.sin")).toBe(false);
    expect(isAppCpuFrame("package:flutter/src/widgets/framework.dart")).toBe(false);
    expect(isAppCpuFrame("AppState.build")).toBe(true);
  });
});

describe("tipForCpuHotspot", () => {
  it("targets build work", () => {
    expect(tipForCpuHotspot(fn("InvoiceListState.build"))).toMatch(/build/i);
  });

  it("targets decoding/parsing", () => {
    expect(tipForCpuHotspot(fn("dart:convert.jsonDecode"))).toMatch(/parse|isolate/i);
  });

  it("falls back to a generic tip", () => {
    expect(tipForCpuHotspot(fn("SomeUnknownFn"))).toMatch(/profile/i);
  });
});
