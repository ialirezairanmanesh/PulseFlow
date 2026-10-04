import 'wire.dart';

/// A node in the CPU flame tree.
class FlameNode {
  FlameNode(this.name, this.value, [this.children]);

  final String name;
  final double value;
  final List<FlameNode>? children;

  Map<String, Object?> toJson() => <String, Object?>{
        'name': name,
        'value': value,
        if (children != null && children!.isNotEmpty)
          'children': children!.map((FlameNode c) => c.toJson()).toList(),
      };
}

/// A ranked CPU function.
class CpuFunctionStat {
  CpuFunctionStat({
    required this.name,
    required this.qualifiedName,
    required this.selfMs,
    required this.totalMs,
    required this.selfPercent,
    required this.totalPercent,
    this.codeUri,
  });

  final String name;
  final String qualifiedName;
  final double selfMs;
  final double totalMs;
  final double selfPercent;
  final double totalPercent;
  final String? codeUri;

  Map<String, Object?> toJson() => <String, Object?>{
        'name': name,
        'qualifiedName': qualifiedName,
        'selfMs': selfMs,
        'totalMs': totalMs,
        'selfPercent': selfPercent,
        'totalPercent': totalPercent,
        if (codeUri != null) 'codeUri': codeUri,
      };
}

/// Aggregated CPU profile for the dashboard.
class CpuProfileSummary {
  CpuProfileSummary({
    required this.durationMs,
    required this.sampleCount,
    required this.samplePeriodMicros,
    required this.topFunctions,
    required this.flameRoot,
    required this.capturedAt,
  });

  final int durationMs;
  final int sampleCount;
  final int samplePeriodMicros;
  final List<CpuFunctionStat> topFunctions;
  final FlameNode flameRoot;
  final int capturedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'durationMs': durationMs,
        'sampleCount': sampleCount,
        'samplePeriodMicros': samplePeriodMicros,
        'topFunctions': topFunctions.map((CpuFunctionStat f) => f.toJson()).toList(),
        'flameRoot': flameRoot.toJson(),
        'capturedAt': capturedAt,
      };
}

const int _maxFlameNodes = 500;
const int _maxStackDepth = 32;
const double _minShare = 0.005;

class _FnLabel {
  _FnLabel(this.name, this.qualifiedName, this.codeUri);
  final String name;
  final String qualifiedName;
  final String? codeUri;
}

_FnLabel _functionLabel(Object? fn, int index) {
  if (fn is! Map) {
    return _FnLabel('(unknown $index)', '(unknown $index)', null);
  }
  final Object? ownerRaw =
      fn['owner'] is Map ? (fn['owner'] as Map)['name'] : null;
  Object? nestedOwner;
  final Object? nestedFn = fn['function'];
  if (nestedFn is Map) {
    final Object? owner = nestedFn['owner'];
    if (owner is Map) nestedOwner = owner['name'];
  }
  final String owner = (ownerRaw ?? nestedOwner ?? '').toString();
  final Object? nameRaw = fn['name'] ??
      (fn['function'] is Map ? (fn['function'] as Map)['name'] : null);
  final String name = (nameRaw ?? 'fn#$index').toString();
  final String qualified = owner.isNotEmpty ? '$owner.$name' : name;
  final String short = name.contains('.') ? name.split('.').last : name;
  return _FnLabel(short.isEmpty ? name : short, qualified, fn['resolvedUrl'] as String?);
}

class _TreeNode {
  _TreeNode(this.name);
  final String name;
  double value = 0;
  final Map<String, _TreeNode> children = <String, _TreeNode>{};
}

class _Budget {
  _Budget(this.left);
  int left;
}

FlameNode _truncate(FlameNode node, _Budget budget) {
  if (budget.left <= 0) return FlameNode(node.name, node.value);
  budget.left -= 1;
  final List<FlameNode>? children = node.children;
  if (children == null || children.isEmpty) return FlameNode(node.name, node.value);

  final double total = node.value == 0 ? 1 : node.value;
  final List<FlameNode> kept = <FlameNode>[];
  double other = 0;
  for (final FlameNode child in children) {
    if (child.value / total < _minShare && children.length > 6) {
      other += child.value;
      continue;
    }
    kept.add(_truncate(child, budget));
  }
  if (other > 0) {
    kept.add(FlameNode('(other)', round2(other)));
    budget.left -= 1;
  }
  kept.sort((FlameNode a, FlameNode b) => b.value.compareTo(a.value));
  return FlameNode(node.name, node.value, kept);
}

FlameNode _toFlame(_TreeNode node, double periodMs) {
  final List<FlameNode> children = node.children.values
      .map((_TreeNode c) => _toFlame(c, periodMs))
      .toList()
    ..sort((FlameNode a, FlameNode b) => b.value.compareTo(a.value));
  return FlameNode(
    node.name,
    double.parse((node.value * periodMs).toStringAsFixed(3)),
    children.isEmpty ? null : children,
  );
}

/// Transforms a raw `getCpuSamples` result into a compact summary.
CpuProfileSummary transformCpuSamples(
  Map<String, dynamic> raw,
  int durationMs,
) {
  final List<dynamic> functions = (raw['functions'] as List<dynamic>?) ?? const <dynamic>[];
  final List<dynamic> samples = (raw['samples'] as List<dynamic>?) ?? const <dynamic>[];
  final num periodMicros = (raw['samplePeriod'] as num?) ?? 1000;
  final double periodMs = periodMicros / 1000;
  final int sampleCount = samples.isNotEmpty
      ? samples.length
      : ((raw['sampleCount'] as num?)?.toInt() ?? 0);

  final Map<int, int> selfCounts = <int, int>{};
  final Map<int, int> totalCounts = <int, int>{};
  final _TreeNode root = _TreeNode('root');

  for (final dynamic sample in samples) {
    final Object? stackRaw = sample is Map ? sample['stack'] : null;
    if (stackRaw is! List || stackRaw.isEmpty) continue;
    final List<int> stack = stackRaw
        .take(_maxStackDepth)
        .map((dynamic e) => (e as num).toInt())
        .toList();
    if (stack.isEmpty) continue;

    selfCounts[stack[0]] = (selfCounts[stack[0]] ?? 0) + 1;
    final Set<int> seen = <int>{};
    for (final int idx in stack) {
      if (seen.add(idx)) {
        totalCounts[idx] = (totalCounts[idx] ?? 0) + 1;
      }
    }

    final List<int> path = stack.reversed.toList();
    _TreeNode cursor = root;
    cursor.value += 1;
    for (final int idx in path) {
      final String label =
          _functionLabel(idx < functions.length ? functions[idx] : null, idx)
              .qualifiedName;
      final _TreeNode child = cursor.children.putIfAbsent(label, () => _TreeNode(label));
      child.value += 1;
      cursor = child;
    }
  }

  final int denom = sampleCount == 0 ? 1 : sampleCount;
  List<CpuFunctionStat> top = selfCounts.entries.map((MapEntry<int, int> e) {
    final _FnLabel meta =
        _functionLabel(e.key < functions.length ? functions[e.key] : null, e.key);
    final int total = totalCounts[e.key] ?? e.value;
    return CpuFunctionStat(
      name: meta.name,
      qualifiedName: meta.qualifiedName,
      selfMs: round2(e.value * periodMs),
      totalMs: round2(total * periodMs),
      selfPercent: double.parse(((e.value / denom) * 100).toStringAsFixed(1)),
      totalPercent: double.parse(((total / denom) * 100).toStringAsFixed(1)),
      codeUri: meta.codeUri,
    );
  }).toList()
    ..sort((CpuFunctionStat a, CpuFunctionStat b) =>
        b.selfPercent.compareTo(a.selfPercent));
  top = top.take(40).toList();

  final FlameNode flame = _truncate(_toFlame(root, periodMs), _Budget(_maxFlameNodes));

  return CpuProfileSummary(
    durationMs: durationMs,
    sampleCount: sampleCount,
    samplePeriodMicros: periodMicros.toInt(),
    topFunctions: top,
    flameRoot: flame,
    capturedAt: DateTime.now().millisecondsSinceEpoch,
  );
}

/// Deterministic demo profile used by mock mode.
CpuProfileSummary mockCpuProfile(int durationMs) {
  final List<CpuFunctionStat> top = <CpuFunctionStat>[
    _mockFn('build', 'InvoiceListState.build', 22, 45, durationMs,
        'package:app/invoice_list.dart'),
    _mockFn('sin', 'dart:math.sin', 18, 18, durationMs, null),
    _mockFn('putIfAbsent', 'ImageCache.putIfAbsent', 12, 20, durationMs, null),
    _mockFn('layout', 'RenderFlex.performLayout', 9, 28, durationMs, null),
    _mockFn('setState', 'State.setState', 7, 35, durationMs, null),
    _mockFn('paint', 'RenderBox.paint', 6, 15, durationMs, null),
    _mockFn('decodeImage', 'instantiateImageCodec', 5, 8, durationMs, null),
    _mockFn('jsonDecode', 'dart:convert.jsonDecode', 4, 6, durationMs, null),
  ];

  final FlameNode root = FlameNode('root', durationMs.toDouble(), <FlameNode>[
    FlameNode('InvoiceListState.build', durationMs * 0.45, <FlameNode>[
      FlameNode('State.setState', durationMs * 0.2),
      FlameNode('RenderFlex.performLayout', durationMs * 0.15),
      FlameNode('dart:convert.jsonDecode', durationMs * 0.06),
    ]),
    FlameNode('dart:math.sin', durationMs * 0.18),
    FlameNode('ImageCache.putIfAbsent', durationMs * 0.2, <FlameNode>[
      FlameNode('instantiateImageCodec', durationMs * 0.08),
    ]),
    FlameNode('RenderBox.paint', durationMs * 0.15),
  ]);

  return CpuProfileSummary(
    durationMs: durationMs,
    sampleCount: durationMs ~/ 2 < 40 ? 40 : durationMs ~/ 2,
    samplePeriodMicros: 1000,
    topFunctions: top,
    flameRoot: root,
    capturedAt: DateTime.now().millisecondsSinceEpoch,
  );
}

CpuFunctionStat _mockFn(
  String name,
  String qualified,
  double selfPercent,
  double totalPercent,
  int durationMs,
  String? codeUri,
) {
  return CpuFunctionStat(
    name: name,
    qualifiedName: qualified,
    selfMs: double.parse((durationMs * selfPercent / 100).toStringAsFixed(2)),
    totalMs: double.parse((durationMs * totalPercent / 100).toStringAsFixed(2)),
    selfPercent: selfPercent,
    totalPercent: totalPercent,
    codeUri: codeUri,
  );
}

/// Whether a qualified name is a framework/VM frame (not app code).
bool isFrameworkOrVmFunction(String qualifiedName) {
  final RegExp vm = RegExp(r'^(dart:|package:flutter/|package:flutter_test/)',
      caseSensitive: false);
  final RegExp internal = RegExp(r'^(::|_kDart|_iso)', caseSensitive: false);
  return vm.hasMatch(qualifiedName) || internal.hasMatch(qualifiedName);
}
