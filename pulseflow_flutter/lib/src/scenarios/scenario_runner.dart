import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import '../state/stress_state.dart';

/// Runs the built-in repeatable scenarios against the live widget tree.
class ScenarioRunner {
  ScenarioRunner._();

  static final ScenarioRunner instance = ScenarioRunner._();

  bool stopRequested = false;
  String? runningId;
  final List<AnimationController> _controllers = <AnimationController>[];

  Future<Map<String, Object?>> run(
    String id,
    Map<String, String> params,
  ) async {
    if (kReleaseMode) {
      return <String, Object?>{
        'ok': false,
        'reason': 'Scenarios only available in debug/profile',
      };
    }
    if (runningId != null) {
      return <String, Object?>{
        'ok': false,
        'reason': 'Scenario already running: $runningId',
      };
    }
    stopRequested = false;
    runningId = id;
    final Stopwatch sw = Stopwatch()..start();
    try {
      switch (id) {
        case 'scrollStorm':
          await _scrollStorm(params);
          break;
        case 'routeThrash':
          await _routeThrash(params);
          break;
        case 'listFlood':
          await _listFlood(params);
          break;
        case 'animationFlood':
          await _animationFlood(params);
          break;
        case 'retainMemory':
          await _retainMemory(params);
          break;
        case 'networkBurst':
          return await _networkBurst(params, sw);
        default:
          return <String, Object?>{'ok': false, 'id': id, 'reason': 'Unknown scenario'};
      }
      return <String, Object?>{
        'ok': true,
        'id': id,
        'durationMs': sw.elapsedMilliseconds,
        'stopped': stopRequested,
      };
    } finally {
      runningId = null;
      stopRequested = false;
    }
  }

  Map<String, Object?> stop() {
    stopRequested = true;
    final String? id = runningId;
    for (final AnimationController c in _controllers) {
      c.dispose();
    }
    _controllers.clear();
    runningId = null;
    return <String, Object?>{'ok': true, 'stopped': true, 'id': id};
  }

  Future<void> _scrollStorm(Map<String, String> params) async {
    final int durationMs = int.tryParse(params['durationMs'] ?? '') ?? 3000;
    final double amplitude = double.tryParse(params['amplitude'] ?? '') ?? 400;
    final DateTime end = DateTime.now().add(Duration(milliseconds: durationMs));
    while (!stopRequested && DateTime.now().isBefore(end)) {
      final List<ScrollPosition> positions = <ScrollPosition>[];
      void visitor(Element el) {
        if (el is StatefulElement && el.state is ScrollableState) {
          positions.add((el.state as ScrollableState).position);
        }
        el.visitChildren(visitor);
      }

      final Element? root = WidgetsBinding.instance.rootElement;
      root?.visitChildren(visitor);
      for (final ScrollPosition pos in positions) {
        if (!pos.hasPixels) continue;
        final double next = (pos.pixels + amplitude).clamp(
          pos.minScrollExtent,
          pos.maxScrollExtent,
        );
        pos.jumpTo(next);
      }
      await Future<void>.delayed(const Duration(milliseconds: 32));
    }
  }

  Future<void> _routeThrash(Map<String, String> params) async {
    final int count = int.tryParse(params['count'] ?? '') ?? 12;
    final NavigatorState? nav = _findNavigator();
    if (nav == null) {
      throw StateError('No Navigator found — wrap app with MaterialApp/WidgetsApp');
    }
    for (var i = 0; i < count && !stopRequested; i++) {
      await nav.push(
        PageRouteBuilder<void>(
          opaque: true,
          pageBuilder: (_, __, ___) => const ColoredBox(
            color: Color(0x22000000),
            child: SizedBox.expand(),
          ),
          transitionDuration: Duration.zero,
          reverseTransitionDuration: Duration.zero,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 40));
      if (nav.canPop()) nav.pop();
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
  }

  NavigatorState? _findNavigator() {
    final Element? root = WidgetsBinding.instance.rootElement;
    NavigatorState? found;
    void visitor(Element el) {
      if (found != null) return;
      if (el.widget is Navigator) {
        final Object state = (el as StatefulElement).state;
        if (state is NavigatorState) found = state;
      }
      el.visitChildren(visitor);
    }

    root?.visitChildren(visitor);
    return found;
  }

  Future<void> _listFlood(Map<String, String> params) async {
    final int count = int.tryParse(params['count'] ?? '') ?? 200;
    final int bursts = int.tryParse(params['bursts'] ?? '') ?? 8;
    final int perBurst = (count / bursts).ceil();
    final Random rng = Random();
    for (var b = 0; b < bursts && !stopRequested; b++) {
      for (var i = 0; i < perBurst; i++) {
        PulseFlowStressState.instance.invoices.add(<String, dynamic>{
          'id': 'SCN-${DateTime.now().microsecondsSinceEpoch}-$i',
          'total': rng.nextDouble() * 500,
          'lines': List<String>.generate(8, (int j) => 'Item $j'),
        });
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }

  Future<void> _animationFlood(Map<String, String> params) async {
    final int durationMs = int.tryParse(params['durationMs'] ?? '') ?? 2500;
    final int count = int.tryParse(params['count'] ?? '') ?? 24;
    final _PulseTickerProvider tickerProvider = _PulseTickerProvider();
    for (var i = 0; i < count; i++) {
      final AnimationController c = AnimationController(
        vsync: tickerProvider,
        duration: const Duration(milliseconds: 300),
      )..repeat(reverse: true);
      _controllers.add(c);
    }
    final DateTime end = DateTime.now().add(Duration(milliseconds: durationMs));
    while (!stopRequested && DateTime.now().isBefore(end)) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    for (final AnimationController c in _controllers) {
      c.dispose();
    }
    _controllers.clear();
    tickerProvider.dispose();
  }

  Future<void> _retainMemory(Map<String, String> params) async {
    final int megabytes = int.tryParse(params['megabytes'] ?? '') ?? 32;
    PulseFlowStressState.instance.retainedBuffers
        .add(List<int>.filled(megabytes * 1024 * 1024, 1));
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }

  Future<Map<String, Object?>> _networkBurst(
    Map<String, String> params,
    Stopwatch sw,
  ) async {
    final Future<void> Function(Map<String, String>)? hook =
        PulseFlowStressState.instance.onNetworkBurst;
    if (hook == null) {
      runningId = null;
      return <String, Object?>{
        'ok': true,
        'id': 'networkBurst',
        'stubbed': true,
        'durationMs': sw.elapsedMilliseconds,
        'message':
            'No network hook — set PulseFlowStressState.instance.onNetworkBurst',
      };
    }
    await hook(params);
    return <String, Object?>{
      'ok': true,
      'id': 'networkBurst',
      'stubbed': false,
      'durationMs': sw.elapsedMilliseconds,
    };
  }
}

class _PulseTickerProvider implements TickerProvider {
  final List<Ticker> _tickers = <Ticker>[];

  @override
  Ticker createTicker(TickerCallback onTick) {
    final Ticker ticker = Ticker(onTick);
    _tickers.add(ticker);
    return ticker;
  }

  void dispose() {
    for (final Ticker t in _tickers) {
      t.dispose();
    }
    _tickers.clear();
  }
}
