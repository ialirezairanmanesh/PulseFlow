import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/scheduler.dart';

/// One detected main-isolate stall (UI freeze).
class StallEvent {
  StallEvent({
    required this.id,
    required this.durationMs,
    required this.atMs,
    this.route,
  });

  final String id;
  final double durationMs;
  final int atMs;
  final String? route;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'durationMs': durationMs,
        'atMs': atMs,
        if (route != null) 'route': route,
      };
}

/// Detects main-isolate freezes by watching gaps between UI-timer ticks.
///
/// When the UI isolate is blocked, [Timer] callbacks are delayed; the gap
/// since the previous tick is the stall duration. Default threshold is 250 ms.
class StallProbe {
  StallProbe._();

  static final StallProbe instance = StallProbe._();

  final Queue<StallEvent> _events = Queue<StallEvent>();
  Timer? _timer;
  DateTime? _lastTick;
  bool _active = false;
  int _seq = 0;
  Duration threshold = const Duration(milliseconds: 250);
  String? Function()? routeProvider;

  bool get active => _active;

  void start({Duration? threshold}) {
    if (kReleaseMode) return;
    if (threshold != null) this.threshold = threshold;
    if (_active) return;
    _active = true;
    _lastTick = DateTime.now();
    _timer = Timer.periodic(const Duration(milliseconds: 50), _onTick);
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _active = false;
    _lastTick = null;
  }

  void reset() {
    _events.clear();
    _seq = 0;
    _lastTick = DateTime.now();
  }

  void _onTick(Timer timer) {
    final DateTime now = DateTime.now();
    final DateTime? previous = _lastTick;
    _lastTick = now;
    if (previous == null) return;
    final Duration gap = now.difference(previous);
    // Subtract the nominal period so a healthy 50 ms tick is not a stall.
    final Duration excess = gap - const Duration(milliseconds: 50);
    if (excess < threshold) return;
    _events.addLast(
      StallEvent(
        id: 'stall-${++_seq}',
        durationMs: double.parse(
          (excess.inMicroseconds / 1000.0).toStringAsFixed(1),
        ),
        atMs: now.millisecondsSinceEpoch,
        route: routeProvider?.call(),
      ),
    );
    while (_events.length > 100) {
      _events.removeFirst();
    }
  }

  /// Test hook: record a synthetic stall without waiting on the timer.
  void debugRecordStall({
    required double durationMs,
    String? route,
  }) {
    _events.addLast(
      StallEvent(
        id: 'stall-${++_seq}',
        durationMs: durationMs,
        atMs: DateTime.now().millisecondsSinceEpoch,
        route: route,
      ),
    );
  }

  Map<String, Object?> report({int limit = 40}) {
    if (kReleaseMode) {
      return <String, Object?>{
        'ok': false,
        'available': false,
        'reason': 'Stall probe is only available in debug/profile builds',
      };
    }
    final List<StallEvent> all = _events.toList();
    final List<StallEvent> recent =
        all.length <= limit ? all : all.sublist(all.length - limit);
    final double maxMs = recent.isEmpty
        ? 0
        : recent
            .map((StallEvent e) => e.durationMs)
            .reduce((double a, double b) => a > b ? a : b);
    return <String, Object?>{
      'ok': true,
      'available': true,
      'active': _active,
      'thresholdMs': threshold.inMilliseconds,
      'total': all.length,
      'maxDurationMs': maxMs,
      'framePhase': SchedulerBinding.instance.schedulerPhase.name,
      'stalls': recent.map((StallEvent e) => e.toJson()).toList(),
    };
  }
}
