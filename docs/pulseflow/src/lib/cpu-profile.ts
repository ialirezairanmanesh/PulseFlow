import type { CpuFunctionStat } from "@/lib/types";

export function tipForCpuHotspot(fn: CpuFunctionStat): string {
  const q = fn.qualifiedName;
  if (/\.build$/i.test(q) || /build\(/i.test(q)) {
    return "Move heavy work out of build(); cache results and shrink rebuild scope.";
  }
  if (/json|decode|encode|parse/i.test(q)) {
    return "Parse off the UI isolate (compute/Isolate) or cache decoded payloads.";
  }
  if (/image|codec|paint|canvas/i.test(q)) {
    return "Cache images/paint; wrap expensive layers with RepaintBoundary.";
  }
  if (/sin|cos|Random|sort|forEach/i.test(q)) {
    return "Avoid tight sync loops on the UI thread; batch or isolate compute.";
  }
  return "Profile in Flutter profile mode; trim sync work on the UI isolate first.";
}

export function isAppCpuFrame(qualifiedName: string): boolean {
  if (/^(dart:|package:flutter\/|package:flutter_test\/)/i.test(qualifiedName)) {
    return false;
  }
  if (/^(::|_kDart)/i.test(qualifiedName)) return false;
  return true;
}
