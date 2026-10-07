// LEGACY stub — prefer package:pulseflow_flutter (`registerPulseFlow()`).
// Kept only for apps that still paste this single file. New work lands in
// ../pulseflow_flutter (RebuildProbe + service extensions).
//
// After hot-restart, PulseFlow can:
// - run stress RPCs
// - sample hot widgets via rebuild counts (debug/profile only)
// - run repeatable lab scenarios (scroll/route/list/animation/memory)

import 'dart:async';
import 'dart:convert';
import 'dart:developer';
import 'dart:math';

// Resolved via examples/pubspec.yaml (Flutter SDK). Copy this file into your app’s lib/.
import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Holds demo state your app can listen to (e.g. with a ValueNotifier).
class PulseFlowStressState {
  PulseFlowStressState._();
  static final instance = PulseFlowStressState._();

  final List<Map<String, dynamic>> invoices = [];
  final List<List<int>> retainedBuffers = [];

  /// Optional app hook for `networkBurst` scenario.
  Future<void> Function(Map<String, String> params)? onNetworkBurst;
}

const _windowMs = 10000;

const _frameworkWidgets = <String>{
  'Text',
  'RichText',
  'Padding',
  'Container',
  'SizedBox',
  'Column',
  'Row',
  'Flex',
  'Stack',
  'Positioned',
  'Align',
  'Center',
  'Expanded',
  'Flexible',
  'Listener',
  'Semantics',
  'KeyedSubtree',
  'RepaintBoundary',
  'InheritedWidget',
  'InheritedModel',
  'Builder',
  'LayoutBuilder',
  'MediaQuery',
  'Directionality',
  'DefaultTextStyle',
  'DefaultSelectionStyle',
  'IconTheme',
  'Theme',
  'Material',
  'Scaffold',
  'GestureDetector',
  'MouseRegion',
  'Focus',
  'FocusScope',
  'FocusTraversalGroup',
  'Overlay',
  'OverlayEntry',
  'TickerMode',
  'IgnorePointer',
  'AbsorbPointer',
  'Opacity',
  'Transform',
  'ClipRect',
  'ClipRRect',
  'DecoratedBox',
  'ConstrainedBox',
  'UnconstrainedBox',
  'LimitedBox',
  'OverflowBox',
  'SizedOverflowBox',
  'FractionallySizedBox',
  'AspectRatio',
  'IntrinsicHeight',
  'IntrinsicWidth',
  'Offstage',
  'Visibility',
  'IndexedStack',
  'Wrap',
  'Flow',
  'CustomMultiChildLayout',
  'SingleChildScrollView',
  'CustomScrollView',
  'NotificationListener',
  'ScrollConfiguration',
  'Scrollable',
  'RawGestureDetector',
  'Actions',
  'Shortcuts',
  'Localizations',
  'Title',
  'Banner',
  'CheckedModeBanner',
  'InkWell',
  'InkResponse',
  'SelectionArea',
  'SelectableRegion',
  'AnimatedBuilder',
  'AnimatedContainer',
  'ListenableBuilder',
  'ValueListenableBuilder',
};

bool _isFrameworkWidgetName(String name) {
  if (name.startsWith('_')) return true;
  if (name.startsWith('Animated')) return true;
  if (name.endsWith('Transition')) return true;
  return _frameworkWidgets.contains(name);
}

class _WidgetEntry {
  _WidgetEntry({
    required this.id,
    required this.name,
    required this.route,
    this.keyLabel,
  });

  final String id;
  final String name;
  final String route;
  final String? keyLabel;
  int session = 0;
  final List<DateTime> hits = <DateTime>[];
  DateTime lastSeen = DateTime.now();
}

class _WidgetProbe {
  _WidgetProbe._();
  static final instance = _WidgetProbe._();

  bool active = false;
  bool frozen = false;
  RebuildDirtyWidgetCallback? _previous;
  final Map<String, _WidgetEntry> entries = <String, _WidgetEntry>{};

  void start() {
    if (active) return;
    active = true;
    frozen = false;
    _previous = debugOnRebuildDirtyWidget;
    debugOnRebuildDirtyWidget = (Element element, bool builtOnce) {
      _previous?.call(element, builtOnce);
      _record(element);
    };
  }

  void stop() {
    if (!active) return;
    debugOnRebuildDirtyWidget = _previous;
    _previous = null;
    active = false;
    frozen = false;
    entries.clear();
  }

  void reset() {
    entries.clear();
  }

  void setFrozen(bool value) {
    frozen = value;
  }

  String? currentRoute;

  String? _keyLabel(Key? key) {
    if (key == null) return null;
    if (key is ValueKey) return 'ValueKey(${key.value})';
    if (key is ObjectKey) return 'ObjectKey(${key.value})';
    if (key is GlobalKey) return 'GlobalKey';
    if (key is UniqueKey) return 'UniqueKey';
    return key.toString();
  }

  bool _usefulScreenName(String name) {
    if (name.isEmpty || name.startsWith('_')) return false;
    const skip = {
      'MaterialApp',
      'CupertinoApp',
      'WidgetsApp',
      'Navigator',
      'Overlay',
      'Scaffold',
      'Material',
      'AnimatedBuilder',
      'ListenableBuilder',
      'ValueListenableBuilder',
      'StreamBuilder',
      'FutureBuilder',
      'Builder',
    };
    if (skip.contains(name)) return false;
    return RegExp(r'(Page|Screen|View|Route|Tab|Dashboard|Home|Sheet|Dialog)$')
        .hasMatch(name);
  }

  /// Specific named route → Router URI → nearest *Page/*Screen → `/` → (unnamed).
  String _routeOf(Element element) {
    String? named;
    try {
      final modal = ModalRoute.of(element);
      named = modal?.settings.name;
      if (named == null || named.isEmpty) {
        final settings = modal?.settings;
        if (settings is Page) {
          named = settings.name;
          if (named == null || named.isEmpty) {
            final pageType = settings.runtimeType.toString();
            if (_usefulScreenName(pageType)) named = pageType;
          }
        }
      }
    } catch (_) {}

    String? fromRouter;
    try {
      final provider = Router.maybeOf(element)?.routeInformationProvider;
      if (provider != null) {
        final path = provider.value.uri.path;
        fromRouter = path.isEmpty ? '/' : path;
      }
    } catch (_) {}

    String? screen;
    try {
      element.visitAncestorElements((ancestor) {
        final name = ancestor.widget.runtimeType.toString();
        if (_usefulScreenName(name)) {
          screen = name;
          return false;
        }
        return true;
      });
    } catch (_) {}

    // Bare "/" is MaterialApp's home — prefer a concrete Page/Screen name.
    if (named != null && named.isNotEmpty && named != '/') return named;
    if (fromRouter != null && fromRouter != '/') return fromRouter;
    if (screen != null) return screen!;
    if (named != null && named.isNotEmpty) return named;
    if (fromRouter != null) return fromRouter;
    return '(unnamed)';
  }

  void _record(Element element) {
    final name = element.widget.runtimeType.toString();
    final keyLabel = _keyLabel(element.widget.key);
    final route = _routeOf(element);
    final id = '$route|$name|${keyLabel ?? ''}';
    final now = DateTime.now();
    currentRoute = route;
    final entry = entries.putIfAbsent(
      id,
      () => _WidgetEntry(id: id, name: name, route: route, keyLabel: keyLabel),
    );
    entry.session += 1;
    entry.lastSeen = now;
    if (!frozen) {
      entry.hits.add(now);
    }
  }

  void _pruneWindow(DateTime cutoff) {
    for (final entry in entries.values) {
      entry.hits.removeWhere((t) => t.isBefore(cutoff));
    }
  }

  String _aggregateKey(String route, String name, String? keyLabel) =>
      '$route|$name|${keyLabel ?? ''}';

  /// Prefer a live Navigator/Router location; fall back to last rebuild route.
  String? _detectLiveRoute() {
    try {
      final root = WidgetsBinding.instance.rootElement;
      if (root != null) {
        String? fromRouter;
        String? fromModal;
        void visitor(Element el) {
          if (fromRouter != null && fromModal != null) return;
          try {
            final provider = Router.maybeOf(el)?.routeInformationProvider;
            if (provider != null && fromRouter == null) {
              final path = provider.value.uri.path;
              fromRouter = path.isEmpty ? '/' : path;
            }
          } catch (_) {}
          try {
            final modal = ModalRoute.of(el);
            final named = modal?.settings.name;
            if (named != null && named.isNotEmpty && fromModal == null) {
              fromModal = named;
            }
          } catch (_) {}
          el.visitChildren(visitor);
        }

        root.visitChildren(visitor);
        if (fromModal != null && fromModal != '/') return fromModal;
        if (fromRouter != null && fromRouter != '/') return fromRouter;
        if (fromModal != null) return fromModal;
        if (fromRouter != null) return fromRouter;
      }
    } catch (_) {}
    return currentRoute;
  }

  /// Walk the mounted element tree for [route], merging rebuild counters.
  /// Nodes stay present while mounted — not only while rebuilding.
  List<Map<String, dynamic>> _walkRouteTree({
    required String route,
    required DateTime now,
    required double windowSec,
    required Map<String, _WidgetEntry> rebuildByKey,
    int maxNodes = 500,
  }) {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return <Map<String, dynamic>>[];

    final nodes = <Map<String, dynamic>>[];
    var totalWindowForShare = 0;
    for (final e in rebuildByKey.values) {
      if (e.route == route) totalWindowForShare += e.hits.length;
    }

    void visit(Element el, String? parentId, int depth, bool underRoute) {
      if (nodes.length >= maxNodes) return;
      final name = el.widget.runtimeType.toString();
      final keyLabel = _keyLabel(el.widget.key);
      final elRoute = _routeOf(el);
      final onRoute = elRoute == route;
      final include = underRoute || onRoute;

      String? nodeId;
      if (include) {
        nodeId = 'n${identityHashCode(el)}';
        final aggKey = _aggregateKey(route, name, keyLabel);
        final entry = rebuildByKey[aggKey];
        final windowCount = entry?.hits.length ?? 0;
        final session = entry?.session ?? 0;
        final lastSeenRaw =
            entry == null ? 0 : now.difference(entry.lastSeen).inMilliseconds;
        final lastSeenMs = lastSeenRaw < 0 ? 0 : lastSeenRaw;
        final depthForNode = underRoute ? depth : 0;
        nodes.add(<String, dynamic>{
          'id': nodeId,
          'name': name,
          'route': route,
          if (keyLabel != null) 'keyLabel': keyLabel,
          if (parentId != null) 'parentId': parentId,
          'depth': depthForNode,
          'inTree': true,
          'rebuildsSession': session,
          'rebuildsWindow': windowCount,
          'ratePerSec': windowCount > 0
              ? double.parse((windowCount / windowSec).toStringAsFixed(2))
              : 0.0,
          'share': totalWindowForShare > 0
              ? double.parse(
                  ((windowCount / totalWindowForShare) * 100).toStringAsFixed(1),
                )
              : 0.0,
          'lastSeenMs': lastSeenMs,
          'isFramework': _isFrameworkWidgetName(name),
        });
      }

      final nextUnder = underRoute || onRoute;
      final nextDepth = nextUnder ? (underRoute ? depth + 1 : 1) : depth;
      final nextParent = include ? nodeId : parentId;
      el.visitChildren((child) {
        visit(child, nextParent, nextDepth, nextUnder);
      });
    }

    root.visitChildren((child) {
      visit(child, null, 0, false);
    });
    return nodes;
  }

  Map<String, dynamic> snapshot({int limit = 40}) {
    final now = DateTime.now();
    final cutoff = now.subtract(const Duration(milliseconds: _windowMs));
    if (!frozen) {
      _pruneWindow(cutoff);
    }

    final windowSec = _windowMs / 1000.0;
    final liveRoute = _detectLiveRoute();
    if (liveRoute != null) currentRoute = liveRoute;

    final rebuildByKey = Map<String, _WidgetEntry>.from(entries);

    // Prefer the stable mounted tree for the current screen.
    List<Map<String, dynamic>> tree = <Map<String, dynamic>>[];
    if (currentRoute != null && currentRoute!.isNotEmpty) {
      tree = _walkRouteTree(
        route: currentRoute!,
        now: now,
        windowSec: windowSec,
        rebuildByKey: rebuildByKey,
        maxNodes: limit < 100 ? 500 : limit,
      );
    }

    final widgetMaps = <Map<String, dynamic>>[];
    var totalWindow = 0;
    var totalSession = 0;

    for (final entry in entries.values) {
      final windowCount = entry.hits.length;
      totalWindow += windowCount;
      totalSession += entry.session;
      final lastSeenMs = now.difference(entry.lastSeen).inMilliseconds;
      widgetMaps.add(<String, dynamic>{
        'id': entry.id,
        'name': entry.name,
        'route': entry.route,
        if (entry.keyLabel != null) 'keyLabel': entry.keyLabel,
        'rebuildsSession': entry.session,
        'rebuildsWindow': windowCount,
        'ratePerSec':
            windowCount > 0 ? double.parse((windowCount / windowSec).toStringAsFixed(2)) : 0.0,
        'lastSeenMs': lastSeenMs < 0 ? 0 : lastSeenMs,
        'isFramework': _isFrameworkWidgetName(entry.name),
        'inTree': false,
      });
    }

    widgetMaps.sort((a, b) {
      final aw = a['rebuildsWindow'] as int;
      final bw = b['rebuildsWindow'] as int;
      if (bw != aw) return bw.compareTo(aw);
      return (b['rebuildsSession'] as int).compareTo(a['rebuildsSession'] as int);
    });

    final top = widgetMaps.take(limit).map((w) {
      final rebuilds = w['rebuildsWindow'] as int;
      return <String, dynamic>{
        ...w,
        'share': totalWindow > 0
            ? double.parse(((rebuilds / totalWindow) * 100).toStringAsFixed(1))
            : 0.0,
      };
    }).toList();

    // UI primary list: mounted tree when available, else hot rebuild ranks.
    final primary = tree.isNotEmpty ? tree : top;

    final byRoute = <String, List<Map<String, dynamic>>>{};
    for (final w in primary) {
      final route = w['route'] as String;
      byRoute.putIfAbsent(route, () => <Map<String, dynamic>>[]).add(w);
    }

    final screens = byRoute.entries.map((e) {
      final routeWidgets = e.value;
      final rebuildsWindow =
          routeWidgets.fold<int>(0, (a, w) => a + (w['rebuildsWindow'] as int));
      return <String, dynamic>{
        'route': e.key,
        'rebuildsWindow': rebuildsWindow,
        'ratePerSec': rebuildsWindow > 0
            ? double.parse((rebuildsWindow / windowSec).toStringAsFixed(2))
            : 0.0,
        'share': totalWindow > 0
            ? double.parse(((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1))
            : 0.0,
        'topWidgets': routeWidgets
            .where((w) => (w['rebuildsWindow'] as int) > 0)
            .take(5)
            .toList(),
      };
    }).toList()
      ..sort((a, b) =>
          (b['rebuildsWindow'] as int).compareTo(a['rebuildsWindow'] as int));

    return <String, dynamic>{
      'ok': true,
      'active': active,
      'frozen': frozen,
      'windowMs': _windowMs,
      'totalRebuildsWindow': totalWindow,
      'totalRebuildsSession': totalSession,
      // Back-compat for older bridge builds
      'totalRebuilds': totalWindow,
      'currentRoute': currentRoute,
      'widgets': primary,
      'tree': tree,
      'screens': screens,
    };
  }
}

// --- Scenarios (future package: pulseflow/scenarios.dart) ---

class _ScenarioRunner {
  _ScenarioRunner._();
  static final instance = _ScenarioRunner._();

  bool stopRequested = false;
  String? runningId;
  final List<AnimationController> _controllers = [];

  static const scenarios = <Map<String, String>>[
    {
      'id': 'scrollStorm',
      'label': 'Scroll storm',
      'description': 'Rapid scroll jumps on primary scrollables',
    },
    {
      'id': 'routeThrash',
      'label': 'Route thrash',
      'description': 'Push/pop lightweight routes repeatedly',
    },
    {
      'id': 'listFlood',
      'label': 'List flood',
      'description': 'Burst-append invoice items into stress state',
    },
    {
      'id': 'animationFlood',
      'label': 'Animation flood',
      'description': 'Spawn repeating animation controllers',
    },
    {
      'id': 'retainMemory',
      'label': 'Retain memory',
      'description': 'Allocate and retain byte buffers',
    },
    {
      'id': 'networkBurst',
      'label': 'Network burst',
      'description': 'Stubbed unless the app registers a network hook',
    },
  ];

  Future<Map<String, dynamic>> run(String id, Map<String, String> params) async {
    if (kReleaseMode) {
      return {'ok': false, 'reason': 'Scenarios only available in debug/profile'};
    }
    if (runningId != null) {
      return {'ok': false, 'reason': 'Scenario already running: $runningId'};
    }
    stopRequested = false;
    runningId = id;
    final sw = Stopwatch()..start();
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
          return {'ok': false, 'id': id, 'reason': 'Unknown scenario'};
      }
      return {
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

  Map<String, dynamic> stop() {
    stopRequested = true;
    final id = runningId;
    for (final c in _controllers) {
      c.dispose();
    }
    _controllers.clear();
    runningId = null;
    return {'ok': true, 'stopped': true, 'id': id};
  }

  Future<void> _scrollStorm(Map<String, String> params) async {
    final durationMs = int.tryParse(params['durationMs'] ?? '') ?? 3000;
    final amplitude = double.tryParse(params['amplitude'] ?? '') ?? 400;
    final end = DateTime.now().add(Duration(milliseconds: durationMs));
    while (!stopRequested && DateTime.now().isBefore(end)) {
      final positions = <ScrollPosition>[];
      void visitor(Element el) {
        if (el is StatefulElement && el.state is ScrollableState) {
          positions.add((el.state as ScrollableState).position);
        }
        el.visitChildren(visitor);
      }

      final root = WidgetsBinding.instance.rootElement;
      root?.visitChildren(visitor);
      for (final pos in positions) {
        if (!pos.hasPixels) continue;
        final next = (pos.pixels + amplitude).clamp(
          pos.minScrollExtent,
          pos.maxScrollExtent,
        );
        pos.jumpTo(next);
      }
      await Future<void>.delayed(const Duration(milliseconds: 32));
    }
  }

  Future<void> _routeThrash(Map<String, String> params) async {
    final count = int.tryParse(params['count'] ?? '') ?? 12;
    final nav = _findNavigator();
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
    final root = WidgetsBinding.instance.rootElement;
    NavigatorState? found;
    void visitor(Element el) {
      if (found != null) return;
      if (el.widget is Navigator) {
        final state = (el as StatefulElement).state;
        if (state is NavigatorState) found = state;
      }
      el.visitChildren(visitor);
    }

    root?.visitChildren(visitor);
    return found;
  }

  Future<void> _listFlood(Map<String, String> params) async {
    final count = int.tryParse(params['count'] ?? '') ?? 200;
    final bursts = int.tryParse(params['bursts'] ?? '') ?? 8;
    final perBurst = (count / bursts).ceil();
    final rng = Random();
    for (var b = 0; b < bursts && !stopRequested; b++) {
      for (var i = 0; i < perBurst; i++) {
        PulseFlowStressState.instance.invoices.add({
          'id': 'SCN-${DateTime.now().microsecondsSinceEpoch}-$i',
          'total': rng.nextDouble() * 500,
          'lines': List.generate(8, (j) => 'Item $j'),
        });
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }

  Future<void> _animationFlood(Map<String, String> params) async {
    final durationMs = int.tryParse(params['durationMs'] ?? '') ?? 2500;
    final count = int.tryParse(params['count'] ?? '') ?? 24;
    final tickerProvider = _PulseTickerProvider();
    for (var i = 0; i < count; i++) {
      final c = AnimationController(
        vsync: tickerProvider,
        duration: const Duration(milliseconds: 300),
      )..repeat(reverse: true);
      _controllers.add(c);
    }
    final end = DateTime.now().add(Duration(milliseconds: durationMs));
    while (!stopRequested && DateTime.now().isBefore(end)) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    for (final c in _controllers) {
      c.dispose();
    }
    _controllers.clear();
    tickerProvider.dispose();
  }

  Future<void> _retainMemory(Map<String, String> params) async {
    final megabytes = int.tryParse(params['megabytes'] ?? '') ?? 32;
    PulseFlowStressState.instance.retainedBuffers
        .add(List<int>.filled(megabytes * 1024 * 1024, 1));
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }

  Future<Map<String, dynamic>> _networkBurst(
    Map<String, String> params,
    Stopwatch sw,
  ) async {
    final hook = PulseFlowStressState.instance.onNetworkBurst;
    if (hook == null) {
      runningId = null;
      return {
        'ok': true,
        'id': 'networkBurst',
        'stubbed': true,
        'durationMs': sw.elapsedMilliseconds,
        'message':
            'No network hook — set PulseFlowStressState.instance.onNetworkBurst',
      };
    }
    await hook(params);
    return {
      'ok': true,
      'id': 'networkBurst',
      'stubbed': false,
      'durationMs': sw.elapsedMilliseconds,
    };
  }
}

class _PulseTickerProvider implements TickerProvider {
  final List<Ticker> _tickers = [];

  @override
  Ticker createTicker(TickerCallback onTick) {
    final t = Ticker(onTick);
    _tickers.add(t);
    return t;
  }

  void dispose() {
    for (final t in _tickers) {
      t.dispose();
    }
    _tickers.clear();
  }
}

void registerPulseFlowExtensions() {
  registerExtension('ext.pulseflow.injectInvoices', (method, params) async {
    final count = int.tryParse(params['count']?.toString() ?? '') ?? 100;
    final rng = Random();
    for (var i = 0; i < count; i++) {
      PulseFlowStressState.instance.invoices.add({
        'id': 'INV-${DateTime.now().microsecondsSinceEpoch}-$i',
        'total': rng.nextDouble() * 500,
        'lines': List.generate(8, (j) => 'Item $j'),
      });
    }
    return ServiceExtensionResponse.result('{"ok":true,"injected":$count}');
  });

  registerExtension('ext.pulseflow.spikeCpu', (method, params) async {
    final millis = int.tryParse(params['millis']?.toString() ?? '') ?? 800;
    final sw = Stopwatch()..start();
    var acc = 0.0;
    while (sw.elapsedMilliseconds < millis) {
      acc += sin(sw.elapsedMicroseconds.toDouble());
    }
    return ServiceExtensionResponse.result('{"ok":true,"acc":$acc}');
  });

  registerExtension('ext.pulseflow.allocateMemory', (method, params) async {
    final megabytes = int.tryParse(params['megabytes']?.toString() ?? '') ?? 32;
    PulseFlowStressState.instance.retainedBuffers.add(List<int>.filled(megabytes * 1024 * 1024, 1));
    return ServiceExtensionResponse.result('{"ok":true,"megabytes":$megabytes}');
  });

  registerExtension('ext.pulseflow.startWidgetProbe', (method, params) async {
    if (kReleaseMode) {
      return ServiceExtensionResponse.error(
        ServiceExtensionResponse.extensionError,
        'Widget probe is only available in debug/profile builds',
      );
    }
    _WidgetProbe.instance.start();
    return ServiceExtensionResponse.result(
      jsonEncode({'ok': true, 'active': true}),
    );
  });

  registerExtension('ext.pulseflow.stopWidgetProbe', (method, params) async {
    _WidgetProbe.instance.stop();
    return ServiceExtensionResponse.result(
      jsonEncode({'ok': true, 'active': false}),
    );
  });

  registerExtension('ext.pulseflow.resetWidgetProbe', (method, params) async {
    if (kReleaseMode) {
      return ServiceExtensionResponse.error(
        ServiceExtensionResponse.extensionError,
        'Widget probe is only available in debug/profile builds',
      );
    }
    if (!_WidgetProbe.instance.active) {
      _WidgetProbe.instance.start();
    }
    _WidgetProbe.instance.reset();
    return ServiceExtensionResponse.result(
      jsonEncode({'ok': true, 'active': true, 'reset': true}),
    );
  });

  registerExtension('ext.pulseflow.setWidgetProbeFrozen', (method, params) async {
    if (kReleaseMode) {
      return ServiceExtensionResponse.error(
        ServiceExtensionResponse.extensionError,
        'Widget probe is only available in debug/profile builds',
      );
    }
    if (!_WidgetProbe.instance.active) {
      _WidgetProbe.instance.start();
    }
    final frozen = params['frozen']?.toString().toLowerCase() == 'true' ||
        params['frozen'] == true;
    _WidgetProbe.instance.setFrozen(frozen);
    return ServiceExtensionResponse.result(
      jsonEncode({'ok': true, 'active': true, 'frozen': frozen}),
    );
  });

  registerExtension('ext.pulseflow.getHotWidgets', (method, params) async {
    if (kReleaseMode) {
      return ServiceExtensionResponse.error(
        ServiceExtensionResponse.extensionError,
        'Widget probe is only available in debug/profile builds',
      );
    }
    if (!_WidgetProbe.instance.active) {
      _WidgetProbe.instance.start();
    }
    final limit = int.tryParse(params['limit']?.toString() ?? '') ?? 40;
    final snap = _WidgetProbe.instance.snapshot(limit: limit);
    // True rolling window — do not reset after sample.
    return ServiceExtensionResponse.result(jsonEncode(snap));
  });

  registerExtension('ext.pulseflow.listScenarios', (method, params) async {
    return ServiceExtensionResponse.result(
      jsonEncode({'ok': true, 'scenarios': _ScenarioRunner.scenarios}),
    );
  });

  registerExtension('ext.pulseflow.runScenario', (method, params) async {
    final id = params['id']?.toString() ?? '';
    if (id.isEmpty) {
      return ServiceExtensionResponse.result(
        jsonEncode({'ok': false, 'reason': 'id required'}),
      );
    }
    Map<String, String> scenarioParams = {};
    final raw = params['params']?.toString();
    if (raw != null && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          scenarioParams = decoded.map(
            (k, v) => MapEntry(k.toString(), v.toString()),
          );
        }
      } catch (_) {
        /* ignore malformed params */
      }
    }
    // Also accept flat params from the bridge
    params.forEach((k, v) {
      if (k != 'id' && k != 'params' && k != 'isolateId' && v != null) {
        scenarioParams[k] = v.toString();
      }
    });
    try {
      final result = await _ScenarioRunner.instance.run(id, scenarioParams);
      return ServiceExtensionResponse.result(jsonEncode(result));
    } catch (e) {
      return ServiceExtensionResponse.result(
        jsonEncode({'ok': false, 'id': id, 'reason': e.toString()}),
      );
    }
  });

  registerExtension('ext.pulseflow.stopScenario', (method, params) async {
    final result = _ScenarioRunner.instance.stop();
    return ServiceExtensionResponse.result(jsonEncode(result));
  });
}

// Example main wiring:
//
// void main() {
//   registerPulseFlowExtensions();
//   runApp(const MyApp());
// }
