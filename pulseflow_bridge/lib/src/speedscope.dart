/// Builds a speedscope profile (https://www.speedscope.app) from raw
/// `getCpuSamples` output. Emitting speedscope JSON avoids a protobuf
/// dependency while still giving an offline, shareable artifact.
///
/// VM stacks are leaf-first (index 0 is the top of the stack); speedscope
/// expects each sample's frames in call order (root-first), so stacks are
/// reversed.
Map<String, Object?> buildSpeedscope(
  Map<String, dynamic> raw, {
  required String name,
  int durationMs = 0,
}) {
  final List<dynamic> functions = (raw['functions'] as List<dynamic>?) ?? const <dynamic>[];
  final List<dynamic> samples = (raw['samples'] as List<dynamic>?) ?? const <dynamic>[];
  final num periodMicros = (raw['samplePeriod'] as num?) ?? 1000;
  final double weightMs = periodMicros / 1000.0;

  final List<Map<String, Object?>> frames = <Map<String, Object?>>[];
  final Map<int, int> frameIndexForFunction = <int, int>{};

  int frameIndex(int functionIndex) {
    return frameIndexForFunction.putIfAbsent(functionIndex, () {
      frames.add(<String, Object?>{'name': _frameName(functions, functionIndex)});
      return frames.length - 1;
    });
  }

  final List<List<int>> outSamples = <List<int>>[];
  final List<double> weights = <double>[];
  for (final dynamic sample in samples) {
    final Object? stackRaw = sample is Map ? sample['stack'] : null;
    if (stackRaw is! List || stackRaw.isEmpty) continue;
    final List<int> stack =
        stackRaw.map((dynamic e) => (e as num).toInt()).toList();
    outSamples.add(stack.reversed.map(frameIndex).toList());
    weights.add(weightMs);
  }

  final double endValue =
      durationMs > 0 ? durationMs.toDouble() : outSamples.length * weightMs;

  return <String, Object?>{
    '\$schema': 'https://www.speedscope.app/file-format-schema.json',
    'exporter': 'PulseFlow bridge',
    'name': name,
    'activeProfileIndex': 0,
    'shared': <String, Object?>{'frames': frames},
    'profiles': <Map<String, Object?>>[
      <String, Object?>{
        'type': 'sampled',
        'name': name,
        'unit': 'milliseconds',
        'startValue': 0,
        'endValue': endValue,
        'samples': outSamples,
        'weights': weights,
      },
    ],
  };
}

String _frameName(List<dynamic> functions, int index) {
  if (index < 0 || index >= functions.length) return 'fn#$index';
  final Object? fn = functions[index];
  if (fn is! Map) return 'fn#$index';
  final Object? owner = fn['owner'] is Map ? (fn['owner'] as Map)['name'] : null;
  Object? nestedOwner;
  final Object? nestedFn = fn['function'];
  if (nestedFn is Map) {
    final Object? inner = nestedFn['owner'];
    if (inner is Map) nestedOwner = inner['name'];
  }
  final String ownerName = (owner ?? nestedOwner ?? '').toString();
  final Object? name =
      fn['name'] ?? (nestedFn is Map ? nestedFn['name'] : null);
  final String fnName = (name ?? 'fn#$index').toString();
  return ownerName.isEmpty ? fnName : '$ownerName.$fnName';
}
