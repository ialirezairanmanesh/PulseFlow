/**
 * Transform Dart VM CpuSamples into a compact summary for the UI.
 */

export interface FlameNode {
  name: string;
  value: number;
  children?: FlameNode[];
}

export interface CpuFunctionStat {
  name: string;
  qualifiedName: string;
  selfMs: number;
  totalMs: number;
  selfPercent: number;
  totalPercent: number;
  codeUri?: string;
}

export interface CpuProfileSummary {
  durationMs: number;
  sampleCount: number;
  samplePeriodMicros?: number;
  topFunctions: CpuFunctionStat[];
  flameRoot: FlameNode;
  capturedAt: number;
}

interface CpuFunction {
  kind?: string;
  owner?: { name?: string; type?: string };
  name?: string;
  resolvedUrl?: string;
  function?: { name?: string; owner?: { name?: string } };
}

interface CpuSample {
  tid?: number;
  timestamp?: number;
  stack: number[];
  vmTag?: string;
  userTag?: string;
}

interface CpuSamplesPayload {
  samplePeriod?: number;
  maxStackDepth?: number;
  sampleCount?: number;
  timeOriginMicros?: number;
  timeExtentMicros?: number;
  pid?: number;
  functions?: CpuFunction[];
  samples?: CpuSample[];
}

const MAX_FLAME_NODES = 500;
const MAX_STACK_DEPTH = 32;
const MIN_SHARE = 0.005;

function functionLabel(fn: CpuFunction | undefined, index: number): {
  name: string;
  qualifiedName: string;
  codeUri?: string;
} {
  if (!fn) {
    return { name: `(unknown ${index})`, qualifiedName: `(unknown ${index})` };
  }
  const owner = fn.owner?.name ?? fn.function?.owner?.name ?? "";
  const name = fn.name ?? fn.function?.name ?? `fn#${index}`;
  const qualifiedName = owner ? `${owner}.${name}` : name;
  const short = name.includes(".") ? name.split(".").pop()! : name;
  return {
    name: short || name,
    qualifiedName,
    codeUri: fn.resolvedUrl,
  };
}

function truncateFlame(node: FlameNode, budget: { left: number }): FlameNode {
  if (budget.left <= 0) {
    return { name: node.name, value: node.value };
  }
  budget.left -= 1;
  if (!node.children?.length) return { name: node.name, value: node.value };

  const total = node.value || 1;
  const kept: FlameNode[] = [];
  let other = 0;
  for (const child of node.children) {
    if (child.value / total < MIN_SHARE && node.children.length > 6) {
      other += child.value;
      continue;
    }
    kept.push(truncateFlame(child, budget));
  }
  if (other > 0) {
    kept.push({ name: "(other)", value: Number(other.toFixed(3)) });
    budget.left -= 1;
  }
  kept.sort((a, b) => b.value - a.value);
  return { name: node.name, value: node.value, children: kept };
}

export function transformCpuSamples(
  raw: CpuSamplesPayload,
  durationMs: number,
): CpuProfileSummary {
  const functions = raw.functions ?? [];
  const samples = raw.samples ?? [];
  const periodMicros = raw.samplePeriod ?? 1000;
  const periodMs = periodMicros / 1000;
  const sampleCount = samples.length || raw.sampleCount || 0;

  const selfCounts = new Map<number, number>();
  const totalCounts = new Map<number, number>();

  type TreeNode = { name: string; value: number; children: Map<string, TreeNode> };
  const root: TreeNode = { name: "root", value: 0, children: new Map() };

  for (const sample of samples) {
    const stack = (sample.stack ?? []).slice(0, MAX_STACK_DEPTH);
    if (!stack.length) continue;

    // VM stacks are leaf-first (index 0 = top of stack)
    const leaf = stack[0];
    selfCounts.set(leaf, (selfCounts.get(leaf) ?? 0) + 1);

    const seen = new Set<number>();
    for (const idx of stack) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      totalCounts.set(idx, (totalCounts.get(idx) ?? 0) + 1);
    }

    // Build root→leaf path for flamegraph
    const path = [...stack].reverse();
    let cursor = root;
    cursor.value += 1;
    for (const idx of path) {
      const label = functionLabel(functions[idx], idx).qualifiedName;
      let child = cursor.children.get(label);
      if (!child) {
        child = { name: label, value: 0, children: new Map() };
        cursor.children.set(label, child);
      }
      child.value += 1;
      cursor = child;
    }
  }

  const denom = sampleCount || 1;
  const topFunctions: CpuFunctionStat[] = [...selfCounts.entries()]
    .map(([idx, self]) => {
      const meta = functionLabel(functions[idx], idx);
      const total = totalCounts.get(idx) ?? self;
      return {
        name: meta.name,
        qualifiedName: meta.qualifiedName,
        selfMs: Number((self * periodMs).toFixed(2)),
        totalMs: Number((total * periodMs).toFixed(2)),
        selfPercent: Number(((self / denom) * 100).toFixed(1)),
        totalPercent: Number(((total / denom) * 100).toFixed(1)),
        codeUri: meta.codeUri,
      };
    })
    .sort((a, b) => b.selfPercent - a.selfPercent)
    .slice(0, 40);

  function toFlame(node: TreeNode): FlameNode {
    const children = [...node.children.values()]
      .map(toFlame)
      .sort((a, b) => b.value - a.value);
    return {
      name: node.name,
      value: Number((node.value * periodMs).toFixed(3)),
      children: children.length ? children : undefined,
    };
  }

  const flame = truncateFlame(toFlame(root), { left: MAX_FLAME_NODES });

  return {
    durationMs,
    sampleCount,
    samplePeriodMicros: periodMicros,
    topFunctions,
    flameRoot: flame,
    capturedAt: Date.now(),
  };
}

export function mockCpuProfile(durationMs: number): CpuProfileSummary {
  const topFunctions: CpuFunctionStat[] = [
    {
      name: "build",
      qualifiedName: "InvoiceListState.build",
      selfMs: durationMs * 0.22,
      totalMs: durationMs * 0.45,
      selfPercent: 22,
      totalPercent: 45,
      codeUri: "package:app/invoice_list.dart",
    },
    {
      name: "sin",
      qualifiedName: "dart:math.sin",
      selfMs: durationMs * 0.18,
      totalMs: durationMs * 0.18,
      selfPercent: 18,
      totalPercent: 18,
    },
    {
      name: "putIfAbsent",
      qualifiedName: "ImageCache.putIfAbsent",
      selfMs: durationMs * 0.12,
      totalMs: durationMs * 0.2,
      selfPercent: 12,
      totalPercent: 20,
    },
    {
      name: "layout",
      qualifiedName: "RenderFlex.performLayout",
      selfMs: durationMs * 0.09,
      totalMs: durationMs * 0.28,
      selfPercent: 9,
      totalPercent: 28,
    },
    {
      name: "setState",
      qualifiedName: "State.setState",
      selfMs: durationMs * 0.07,
      totalMs: durationMs * 0.35,
      selfPercent: 7,
      totalPercent: 35,
    },
    {
      name: "paint",
      qualifiedName: "RenderBox.paint",
      selfMs: durationMs * 0.06,
      totalMs: durationMs * 0.15,
      selfPercent: 6,
      totalPercent: 15,
    },
    {
      name: "decodeImage",
      qualifiedName: "instantiateImageCodec",
      selfMs: durationMs * 0.05,
      totalMs: durationMs * 0.08,
      selfPercent: 5,
      totalPercent: 8,
    },
    {
      name: "jsonDecode",
      qualifiedName: "dart:convert.jsonDecode",
      selfMs: durationMs * 0.04,
      totalMs: durationMs * 0.06,
      selfPercent: 4,
      totalPercent: 6,
    },
  ];

  const flameRoot: FlameNode = {
    name: "root",
    value: durationMs,
    children: [
      {
        name: "InvoiceListState.build",
        value: durationMs * 0.45,
        children: [
          { name: "State.setState", value: durationMs * 0.2 },
          { name: "RenderFlex.performLayout", value: durationMs * 0.15 },
          { name: "dart:convert.jsonDecode", value: durationMs * 0.06 },
        ],
      },
      { name: "dart:math.sin", value: durationMs * 0.18 },
      {
        name: "ImageCache.putIfAbsent",
        value: durationMs * 0.2,
        children: [{ name: "instantiateImageCodec", value: durationMs * 0.08 }],
      },
      { name: "RenderBox.paint", value: durationMs * 0.15 },
    ],
  };

  return {
    durationMs,
    sampleCount: Math.max(40, Math.round(durationMs / 2)),
    samplePeriodMicros: 1000,
    topFunctions,
    flameRoot,
    capturedAt: Date.now(),
  };
}

export function isFrameworkOrVmFunction(qualifiedName: string): boolean {
  return (
    /^(dart:|package:flutter\/|package:flutter_test\/)/i.test(qualifiedName) ||
    /^(::|_kDart|_iso)/i.test(qualifiedName)
  );
}
