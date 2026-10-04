import 'dart:io';

import 'package:args/args.dart';
import 'package:pulseflow_bridge/pulseflow_bridge.dart';

Future<void> main(List<String> argv) async {
  final ArgParser parser = ArgParser()
    ..addOption('vm', help: 'VM Service ws:// URL of a running profile app (required).')
    ..addOption('scenarios', defaultsTo: 'listFlood,scrollStorm', help: 'Comma-separated scenario ids.')
    ..addOption('duration-ms', defaultsTo: '4000', help: 'Per-scenario duration.')
    ..addOption('max-p95-build', help: 'Fail if p95 build exceeds this many ms.')
    ..addOption('max-p95-raster', help: 'Fail if p95 raster exceeds this many ms.')
    ..addOption('max-jank-ratio', help: 'Fail if the jank ratio exceeds this (0..1).')
    ..addOption('out', help: 'Write a JSON report to this path.')
    ..addFlag('json', negatable: false, help: 'Print the JSON report to stdout.');

  final ArgResults args = parser.parse(argv);
  final String vmUri = '${args['vm'] ?? ''}';
  if (vmUri.isEmpty) {
    stderr.writeln('pulseflow-check: --vm is required (e.g. ws://127.0.0.1:8181/AUTH=/ws)');
    stderr.writeln(parser.usage);
    exit(64);
  }

  double? parseNum(String key) {
    final Object? raw = args[key];
    if (raw == null || '${raw}'.isEmpty) return null;
    return double.tryParse('$raw');
  }

  final CheckOptions options = CheckOptions(
    vmUri: vmUri,
    scenarios: '${args['scenarios']}'
        .split(',')
        .map((String s) => s.trim())
        .where((String s) => s.isNotEmpty)
        .toList(),
    durationMs: int.tryParse('${args['duration-ms']}') ?? 4000,
    maxP95Build: parseNum('max-p95-build'),
    maxP95Raster: parseNum('max-p95-raster'),
    maxJankRatio: parseNum('max-jank-ratio'),
    out: args['out'] as String?,
    json: args['json'] as bool,
  );

  exit(await runCheck(options));
}
