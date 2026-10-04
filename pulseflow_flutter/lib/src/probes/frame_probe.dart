import 'dart:collection';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/scheduler.dart';

import '../device/display_info.dart';

const int _maxFrames = 600;

/// A single rendered frame, measured by the engine.
class FrameSample {
  const FrameSample({
    required this.buildMs,
    required this.rasterMs,
    required this.vsyncMs,
    required this.totalMs,
    required this.jank,
  });

  final double buildMs;
  final double rasterMs;
  final double vsyncMs;
  final double totalMs;
  final bool jank;

  Map<String, Object?> toJson() => <String, Object?>{
        'buildMs': buildMs,
        'rasterMs': rasterMs,
        'vsyncMs': vsyncMs,
        'totalMs': totalMs,
        'jank': jank,
      };
}

/// Captures engine frame timings via [SchedulerBinding.addTimingsCallback].
///
/// This is the accurate replacement for estimating frame cost from synthetic
/// build/raster values: the engine already reports real timings in debug and
/// profile builds.
class FrameProbe {
  FrameProbe._();

  static final FrameProbe instance = FrameProbe._();

  final Queue<FrameSample> _frames = Queue<FrameSample>();
  bool _active = false;
  DisplayInfo _display = const DisplayInfo(
    refreshRate: 60,
    budgetMs: 16.666666666666668,
  );

  bool get active => _active;

  DisplayInfo get display => _display;

  void start() {
    if (_active) return;
    _active = true;
    _display = resolveDisplayInfo();
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
  }

  void stop() {
    if (!_active) return;
    _active = false;
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
  }

  void reset() {
    _frames.clear();
    _display = resolveDisplayInfo();
  }

  /// Feeds timings directly — for unit tests only.
  @visibleForTesting
  void debugAddTimings(List<FrameTiming> timings) => _onTimings(timings);

  void _onTimings(List<FrameTiming> timings) {
    final double budgetMs = _display.budgetMs;
    for (final FrameTiming timing in timings) {
      final double totalMs = timing.totalSpan.inMicroseconds / 1000.0;
      _frames.addLast(
        FrameSample(
          buildMs: _round(timing.buildDuration.inMicroseconds / 1000.0),
          rasterMs: _round(timing.rasterDuration.inMicroseconds / 1000.0),
          vsyncMs: _round(timing.vsyncOverhead.inMicroseconds / 1000.0),
          totalMs: _round(totalMs),
          jank: totalMs > budgetMs,
        ),
      );
      while (_frames.length > _maxFrames) {
        _frames.removeFirst();
      }
    }
  }

  Map<String, Object?> snapshot({int limit = 120}) {
    final List<FrameSample> all = _frames.toList();
    final List<FrameSample> recent =
        all.length <= limit ? all : all.sublist(all.length - limit);
    return <String, Object?>{
      'ok': true,
      'active': _active,
      'refreshRate': _display.refreshRate,
      'budgetMs': _display.budgetMs,
      'count': recent.length,
      'jank': recent.where((FrameSample f) => f.jank).length,
      'p95': _percentiles(all),
      'frames': recent.map((FrameSample f) => f.toJson()).toList(),
    };
  }

  Map<String, double> _percentiles(List<FrameSample> all) {
    if (all.isEmpty) {
      return const <String, double>{'buildMs': 0, 'rasterMs': 0, 'totalMs': 0};
    }
    return <String, double>{
      'buildMs': _round(_p95(all.map((FrameSample f) => f.buildMs).toList())),
      'rasterMs': _round(_p95(all.map((FrameSample f) => f.rasterMs).toList())),
      'totalMs': _round(_p95(all.map((FrameSample f) => f.totalMs).toList())),
    };
  }
}

double _p95(List<double> values) {
  if (values.isEmpty) return 0;
  final List<double> sorted = <double>[...values]..sort();
  final int index = ((sorted.length - 1) * 0.95).round();
  return sorted[index];
}

double _round(double value) => double.parse(value.toStringAsFixed(2));
