import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service.dart' as vm;
import 'package:vm_service/vm_service_io.dart';

/// Options for a headless PulseFlow budget check.
class CheckOptions {
  CheckOptions({
    required this.vmUri,
    this.scenarios = const <String>['listFlood', 'scrollStorm'],
    this.durationMs = 4000,
    this.maxP95Build,
    this.maxP95Raster,
    this.maxJankRatio,
    this.out,
    this.json = false,
    this.scenarioTimeoutMs = 60000,
  });

  final String vmUri;
  final List<String> scenarios;
  final int durationMs;
  final double? maxP95Build;
  final double? maxP95Raster;
  final double? maxJankRatio;
  final String? out;
  final bool json;
  final int scenarioTimeoutMs;
}

/// Aggregated frame statistics for a check run.
class FrameStats {
  FrameStats({
    required this.sampleCount,
    required this.p95BuildMs,
    required this.p95RasterMs,
    required this.jankRatio,
  });

  final int sampleCount;
  final double p95BuildMs;
  final double p95RasterMs;
  final double jankRatio;

  Map<String, Object?> toJson() => <String, Object?>{
        'sampleCount': sampleCount,
        'p95BuildMs': p95BuildMs,
        'p95RasterMs': p95RasterMs,
        'jankRatio': double.parse(jankRatio.toStringAsFixed(3)),
      };
}

/// Returns human-readable budget violations (empty when within budget).
List<String> evaluateBudgets(
  FrameStats stats, {
  double? maxP95Build,
  double? maxP95Raster,
  double? maxJankRatio,
}) {
  final List<String> violations = <String>[];
  if (maxP95Build != null && stats.p95BuildMs > maxP95Build) {
    violations.add('p95 build ${stats.p95BuildMs} ms > ${maxP95Build} ms');
  }
  if (maxP95Raster != null && stats.p95RasterMs > maxP95Raster) {
    violations.add('p95 raster ${stats.p95RasterMs} ms > ${maxP95Raster} ms');
  }
  if (maxJankRatio != null && stats.jankRatio > maxJankRatio) {
    violations.add(
      'jank ratio ${(stats.jankRatio * 100).toStringAsFixed(1)}% > '
      '${(maxJankRatio * 100).toStringAsFixed(1)}%',
    );
  }
  return violations;
}

/// Runs the headless check. Returns a process exit code:
/// `0` pass, `1` budget violation, `2` connection/setup error.
Future<int> runCheck(CheckOptions options) async {
  vm.VmService? service;
  final List<Map<String, dynamic>> allFrames = <Map<String, dynamic>>[];
  final List<Map<String, Object?>> scenarioResults = <Map<String, Object?>>[];
  double refreshRate = 60;
  double budgetMs = 1000 / 60;

  try {
    service = await vmServiceConnectUri(options.vmUri);
    final vm.VM info = await service.getVM();
    final List<vm.IsolateRef> isolates = info.isolates ?? <vm.IsolateRef>[];
    vm.IsolateRef? main;
    for (final vm.IsolateRef iso in isolates) {
      if (iso.isSystemIsolate == true) continue;
      if (RegExp('main', caseSensitive: false).hasMatch(iso.name ?? '')) {
        main = iso;
        break;
      }
    }
    main ??= _firstNonSystem(isolates);
    if (main?.id == null) {
      stderr.writeln('pulseflow-check: no Dart isolate found on ${options.vmUri}');
      return 2;
    }
    final String isolateId = main!.id!;
    final vm.Isolate isolate = await service.getIsolate(isolateId);
    final List<String> methods = isolate.extensionRPCs ?? <String>[];
    if (!methods.contains('ext.pulseflow.getFrameStats') ||
        !methods.contains('ext.pulseflow.runScenario')) {
      stderr.writeln(
        'pulseflow-check: PulseFlow extension not registered. Run the app with '
        'registerPulseFlow() in a debug/profile build.',
      );
      return 2;
    }

    final Map<String, dynamic>? initial = await _extension(
      service,
      isolateId,
      'ext.pulseflow.getFrameStats',
      <String, dynamic>{'limit': '10'},
    );
    final num? budget = initial?['budgetMs'] as num?;
    final num? rate = initial?['refreshRate'] as num?;
    if (budget != null && budget > 0) budgetMs = budget.toDouble();
    if (rate != null && rate > 0) refreshRate = rate.toDouble();

    for (final String scenario in options.scenarios) {
      await _extension(
        service,
        isolateId,
        'ext.pulseflow.runScenario',
        <String, dynamic>{
          'id': scenario,
          'params': jsonEncode(<String, String>{'durationMs': '${options.durationMs}'}),
        },
        timeout: Duration(milliseconds: options.scenarioTimeoutMs),
      );
      final Map<String, dynamic>? stats = await _extension(
        service,
        isolateId,
        'ext.pulseflow.getFrameStats',
        <String, dynamic>{'limit': '300'},
      );
      final List<Map<String, dynamic>> frames =
          ((stats?['frames'] as List<dynamic>?) ?? <dynamic>[])
              .whereType<Map>()
              .map((Map<dynamic, dynamic> m) => m.cast<String, dynamic>())
              .toList();
      final int keep = (options.durationMs ~/ 12).clamp(10, frames.length);
      final List<Map<String, dynamic>> window =
          frames.length > keep ? frames.sublist(frames.length - keep) : frames;
      allFrames.addAll(window);
      scenarioResults.add(<String, Object?>{
        'id': scenario,
        'frames': window.length,
      });
    }
  } catch (error) {
    stderr.writeln('pulseflow-check: $error');
    return 2;
  } finally {
    service?.dispose();
  }

  final FrameStats stats = _statsFromFrames(allFrames);
  final List<String> violations = evaluateBudgets(
    stats,
    maxP95Build: options.maxP95Build,
    maxP95Raster: options.maxP95Raster,
    maxJankRatio: options.maxJankRatio,
  );

  final Map<String, Object?> report = <String, Object?>{
    'tool': 'pulseflow-check',
    'vm': options.vmUri,
    'scenarios': options.scenarios,
    'durationMs': options.durationMs,
    'refreshRate': refreshRate,
    'budgetMs': budgetMs,
    'stats': stats.toJson(),
    'violations': violations,
    'passed': violations.isEmpty,
  };

  if (options.out != null) {
    File(options.out!)
        .writeAsStringSync(const JsonEncoder.withIndent('  ').convert(report));
  }

  if (options.json) {
    stdout.writeln(jsonEncode(report));
  } else {
    stdout.writeln('PulseFlow check — ${options.scenarios.join(', ')}');
    stdout.writeln(
      '  frames ${stats.sampleCount} · p95 build ${stats.p95BuildMs} ms · '
      'p95 raster ${stats.p95RasterMs} ms · jank ${(stats.jankRatio * 100).toStringAsFixed(1)}%',
    );
    if (violations.isEmpty) {
      stdout.writeln('  PASS');
    } else {
      for (final String v in violations) {
        stdout.writeln('  FAIL: $v');
      }
    }
  }

  return violations.isEmpty ? 0 : 1;
}

vm.IsolateRef? _firstNonSystem(List<vm.IsolateRef> isolates) {
  for (final vm.IsolateRef iso in isolates) {
    if (iso.isSystemIsolate != true) return iso;
  }
  return isolates.isNotEmpty ? isolates.first : null;
}

Future<Map<String, dynamic>?> _extension(
  vm.VmService service,
  String isolateId,
  String method,
  Map<String, dynamic> args, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final vm.Response response = await service
      .callServiceExtension(method, isolateId: isolateId, args: args)
      .timeout(timeout);
  final Object? json = response.json?['json'];
  if (json is String) {
    final Object? decoded = jsonDecode(json);
    return decoded is Map ? decoded.cast<String, dynamic>() : null;
  }
  return response.json;
}

FrameStats _statsFromFrames(List<Map<String, dynamic>> frames) {
  if (frames.isEmpty) {
    return FrameStats(
      sampleCount: 0,
      p95BuildMs: 0,
      p95RasterMs: 0,
      jankRatio: 0,
    );
  }
  final List<double> builds = frames
      .map((Map<String, dynamic> f) => ((f['buildMs'] as num?) ?? 0).toDouble())
      .toList();
  final List<double> rasters = frames
      .map((Map<String, dynamic> f) => ((f['rasterMs'] as num?) ?? 0).toDouble())
      .toList();
  final int jank = frames.where((Map<String, dynamic> f) => f['jank'] == true).length;
  return FrameStats(
    sampleCount: frames.length,
    p95BuildMs: _p95(builds),
    p95RasterMs: _p95(rasters),
    jankRatio: jank / frames.length,
  );
}

double _p95(List<double> values) {
  if (values.isEmpty) return 0;
  final List<double> sorted = <double>[...values]..sort();
  final int index = ((sorted.length - 1) * 0.95).round();
  return double.parse(sorted[index].toStringAsFixed(2));
}
