/**
 * Parse Flutter `--analyze-size` JSON (`*-code-size-analysis_*.json`) and
 * rank what dominates the binary: top-level buckets, Dart packages, assets.
 */

export interface SizeNode {
  name: string;
  bytes: number;
  children: SizeNode[];
}

export type SizeKind = "dart_package" | "asset" | "native" | "flutter" | "other";

export interface SizeEntry {
  name: string;
  path: string;
  bytes: number;
  share: number;
  kind: SizeKind;
}

export interface SizeAnalysis {
  rootName: string;
  totalBytes: number;
  type: string | null;
  /** First-level APK/IPA buckets (lib/, assets/, META-INF/, …). */
  categories: SizeEntry[];
  /** Dart `package:*` rolled up under libapp / AOT. */
  packages: SizeEntry[];
  /** Files under assets/ (and similar). */
  assets: SizeEntry[];
  /** Largest leaf-ish contributors across the tree (for a quick “what to cut”). */
  top: SizeEntry[];
  tips: string[];
}

export interface SizeDiffRow {
  name: string;
  kind: SizeKind;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  deltaSharePts: number;
}

export interface SizeDiff {
  beforeTotal: number;
  afterTotal: number;
  deltaBytes: number;
  grew: SizeDiffRow[];
  shrank: SizeDiffRow[];
}

type RawNode = {
  n?: unknown;
  name?: unknown;
  value?: unknown;
  children?: unknown;
  type?: unknown;
};

function asRecord(v: unknown): RawNode | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as RawNode) : null;
}

function parseNode(raw: unknown): SizeNode | null {
  const o = asRecord(raw);
  if (!o) return null;
  const name = String(o.n ?? o.name ?? "(unnamed)");
  const bytes = Number(o.value ?? 0);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const kidsRaw = Array.isArray(o.children) ? o.children : [];
  const children: SizeNode[] = [];
  for (const c of kidsRaw) {
    const child = parseNode(c);
    if (child) children.push(child);
  }
  return { name, bytes, children };
}

export function parseSizeAnalysisJson(input: unknown): SizeNode & { type: string | null } {
  const raw = asRecord(input);
  if (!raw || (raw.n == null && raw.name == null)) {
    throw new Error("Not a Flutter size-analysis JSON (expected { n, value, children }).");
  }
  const root = parseNode(input);
  if (!root) {
    throw new Error("Not a Flutter size-analysis JSON (expected { n, value, children }).");
  }
  const typeRaw = raw.type;
  const type = typeof typeRaw === "string" && typeRaw ? typeRaw : null;
  return { ...root, type };
}

function classify(name: string, path: string): SizeKind {
  const lower = `${path}/${name}`.toLowerCase();
  if (/^package:/.test(name) || /\/package:[^/]+/.test(lower)) return "dart_package";
  if (/(^|\/)assets?(\/|$)/.test(lower) || /\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|json|bin)$/i.test(name)) {
    return "asset";
  }
  if (/libflutter|flutter\.framework|flutter_assets/i.test(lower)) return "flutter";
  if (/\.so$/i.test(name) || /libapp\.so|lib\/(arm|x86|armeabi)/i.test(lower)) return "native";
  return "other";
}

function walk(
  node: SizeNode,
  path: string,
  visit: (node: SizeNode, path: string) => void,
): void {
  const here = path ? `${path}/${node.name}` : node.name;
  visit(node, here);
  for (const c of node.children) walk(c, here, visit);
}

function withShare(entries: Omit<SizeEntry, "share">[], total: number): SizeEntry[] {
  const t = total > 0 ? total : 1;
  return entries
    .map((e) => ({ ...e, share: Number(((e.bytes / t) * 100).toFixed(2)) }))
    .sort((a, b) => b.bytes - a.bytes);
}

function tipFor(entry: SizeEntry): string | null {
  if (entry.bytes < 50 * 1024) return null;
  if (entry.kind === "asset") {
    if (/\.(png|jpe?g)$/i.test(entry.name)) {
      return `Compress or convert ${entry.name} to WebP/AVIF; drop unused resolutions.`;
    }
    if (/\.(ttf|otf)$/i.test(entry.name)) {
      return `Subset font ${entry.name} (only glyphs you use) or switch to a smaller family.`;
    }
    return `Trim asset ${entry.name} — remove unused images/fonts from pubspec assets.`;
  }
  if (entry.kind === "dart_package") {
    const pkg = entry.name.replace(/^package:/, "");
    return `Review dependency \`${pkg}\` — remove if unused, or replace with a lighter alternative.`;
  }
  if (entry.kind === "native" && /libapp/i.test(entry.name)) {
    return "Dart AOT dominates — cut unused packages and deferred-load heavy features where possible.";
  }
  if (entry.kind === "flutter") {
    return null;
  }
  return null;
}

/**
 * Build a ranked size report from a Flutter `--analyze-size` JSON document.
 */
export function analyzeAppSize(input: unknown, opts: { topN?: number } = {}): SizeAnalysis {
  const topN = opts.topN ?? 25;
  const root = parseSizeAnalysisJson(input);
  const total = root.bytes > 0 ? root.bytes : root.children.reduce((s, c) => s + c.bytes, 0);

  const categories = withShare(
    root.children.map((c) => ({
      name: c.name,
      path: c.name,
      bytes: c.bytes,
      kind: classify(c.name, c.name),
    })),
    total,
  );

  const packageMap = new Map<string, number>();
  const assetMap = new Map<string, { bytes: number; path: string }>();
  const candidates: Omit<SizeEntry, "share">[] = [];

  walk(root, "", (node, path) => {
    const kind = classify(node.name, path);
    // Roll up only top-level `package:foo` nodes (skip nested package children).
    if (/^package:/.test(node.name)) {
      const ancestors = path.split("/").slice(0, -1);
      const nestedUnderPackage = ancestors.some((p) => /^package:/.test(p));
      if (!nestedUnderPackage) {
        packageMap.set(node.name, (packageMap.get(node.name) ?? 0) + node.bytes);
      }
    }
    const underAssets = /(^|\/)assets?(\/|$)/i.test(path) || /(^|\/)flutter_assets(\/|$)/i.test(path);
    if (underAssets && node.children.length === 0 && node.bytes > 0) {
      const prev = assetMap.get(node.name);
      if (!prev || node.bytes > prev.bytes) {
        assetMap.set(node.name, { bytes: node.bytes, path });
      }
    }
    // Prefer mid-level nodes for "top" (not the root, not tiny leaves).
    if (node !== root && node.bytes >= 32 * 1024) {
      candidates.push({ name: node.name, path, bytes: node.bytes, kind });
    }
  });

  const packages = withShare(
    [...packageMap.entries()].map(([name, bytes]) => ({
      name,
      path: name,
      bytes,
      kind: "dart_package" as const,
    })),
    total,
  );

  const assets = withShare(
    [...assetMap.entries()].map(([name, v]) => ({
      name,
      path: v.path,
      bytes: v.bytes,
      kind: "asset" as const,
    })),
    total,
  );

  // Dedupe by name keeping largest; avoid listing every tiny symbol.
  const seen = new Set<string>();
  const top: SizeEntry[] = [];
  for (const e of withShare(candidates, total)) {
    const key = `${e.kind}:${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(e);
    if (top.length >= topN) break;
  }

  const tipSources = [...top.slice(0, 12), ...packages.slice(0, 8), ...assets.slice(0, 8)];
  const tips: string[] = [];
  const tipSeen = new Set<string>();
  for (const e of tipSources) {
    const tip = tipFor(e);
    if (!tip || tipSeen.has(tip)) continue;
    tipSeen.add(tip);
    tips.push(tip);
    if (tips.length >= 8) break;
  }
  if (tips.length === 0) {
    tips.push(
      "Build a release with `flutter build apk --analyze-size --target-platform=android-arm64` and import the JSON here.",
    );
  }

  return {
    rootName: root.name,
    totalBytes: total,
    type: root.type,
    categories,
    packages,
    assets,
    top,
    tips,
  };
}

function indexByName(entries: SizeEntry[]): Map<string, SizeEntry> {
  const m = new Map<string, SizeEntry>();
  for (const e of entries) m.set(e.name, e);
  return m;
}

/** Diff two analyses (same app, before/after a size fix). */
export function diffAppSize(before: SizeAnalysis, after: SizeAnalysis, limit = 20): SizeDiff {
  const keys = new Set<string>([
    ...before.packages.map((p) => p.name),
    ...after.packages.map((p) => p.name),
    ...before.assets.map((a) => a.name),
    ...after.assets.map((a) => a.name),
    ...before.categories.map((c) => c.name),
    ...after.categories.map((c) => c.name),
  ]);
  const bPkg = indexByName(before.packages);
  const aPkg = indexByName(after.packages);
  const bAst = indexByName(before.assets);
  const aAst = indexByName(after.assets);
  const bCat = indexByName(before.categories);
  const aCat = indexByName(after.categories);

  const rows: SizeDiffRow[] = [];
  for (const name of keys) {
    const b = bPkg.get(name) ?? bAst.get(name) ?? bCat.get(name);
    const a = aPkg.get(name) ?? aAst.get(name) ?? aCat.get(name);
    const beforeBytes = b?.bytes ?? 0;
    const afterBytes = a?.bytes ?? 0;
    const delta = afterBytes - beforeBytes;
    if (delta === 0) continue;
    rows.push({
      name,
      kind: a?.kind ?? b?.kind ?? "other",
      beforeBytes,
      afterBytes,
      deltaBytes: delta,
      deltaSharePts: Number((((afterBytes / (after.totalBytes || 1)) - (beforeBytes / (before.totalBytes || 1))) * 100).toFixed(2)),
    });
  }
  rows.sort((x, y) => Math.abs(y.deltaBytes) - Math.abs(x.deltaBytes));
  return {
    beforeTotal: before.totalBytes,
    afterTotal: after.totalBytes,
    deltaBytes: after.totalBytes - before.totalBytes,
    grew: rows.filter((r) => r.deltaBytes > 0).slice(0, limit),
    shrank: rows.filter((r) => r.deltaBytes < 0).slice(0, limit),
  };
}

export function formatSizeKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
