import 'dart:collection';

import 'package:flutter/widgets.dart';

import 'rebuild_cause.dart';
import 'route_label.dart';
import 'widget_source.dart';

const int _windowMs = 10000;

const Set<String> _frameworkWidgets = <String>{
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

/// True for Flutter/Material shells and private Element wrappers (`_Foo`).
bool isFrameworkWidgetName(String name) {
  if (name.startsWith('_')) return true;
  if (name.startsWith('Animated')) return true;
  if (name.endsWith('Transition')) return true;
  return _frameworkWidgets.contains(name);
}

class WidgetEntry {
  WidgetEntry({
    required this.id,
    required this.name,
    required this.route,
    this.keyLabel,
    this.sourceFile,
    this.sourceLine,
  });

  final String id;
  final String name;
  final String route;
  final String? keyLabel;
  final String? sourceFile;
  final int? sourceLine;
  int session = 0;
  final List<DateTime> hits = <DateTime>[];
  DateTime lastSeen = DateTime.now();
}

class _FrameNode {
  _FrameNode({
    required this.widgetId,
    required this.name,
    required this.route,
    this.sourceUri,
    this.sourceLine,
  });

  final String widgetId;
  final String name;
  final String route;
  final String? sourceUri;
  final int? sourceLine;
}

class _RootWindow {
  _RootWindow({required this.widget, required this.route, this.sourceUri, this.sourceLine});

  final String widget;
  final String route;
  final String? sourceUri;
  final int? sourceLine;
  int children = 0;
  final List<DateTime> hits = <DateTime>[];
}

class _AttrWindow {
  _AttrWindow(this.widget, this.root);

  final String widget;
  final String root;
  final List<DateTime> hits = <DateTime>[];
}

/// Samples dirty-widget rebuilds via [debugOnRebuildDirtyWidget] and resolves
/// the app source location of each widget on first sight.
class RebuildProbe {
  RebuildProbe._();

  static final RebuildProbe instance = RebuildProbe._();

  bool active = false;
  bool frozen = false;

  /// When set, only source locations inside this package are kept.
  String? appPackage;

  /// Resolve `file:line` for new widgets (debug/profile only).
  bool resolveSource = true;

  /// Last route seen for a rebuilt widget (used to attribute errors).
  String? lastRoute;

  RebuildDirtyWidgetCallback? _previous;
  final Map<String, WidgetEntry> entries = <String, WidgetEntry>{};
  final HashMap<Element, _FrameNode> _frameNodes = HashMap<Element, _FrameNode>.identity();
  bool _frameScheduled = false;
  final Map<String, _RootWindow> _roots = <String, _RootWindow>{};
  final Map<String, _AttrWindow> _attributed = <String, _AttrWindow>{};

  void start() {
    if (active) return;
    active = true;
    frozen = false;
    _frameNodes.clear();
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
    _frameNodes.clear();
    _roots.clear();
    _attributed.clear();
  }

  void reset() {
    entries.clear();
    _frameNodes.clear();
    _roots.clear();
    _attributed.clear();
  }

  void setFrozen(bool value) {
    frozen = value;
  }

  String? _keyLabel(Key? key) {
    if (key == null) return null;
    if (key is ValueKey) return 'ValueKey(${key.value})';
    if (key is ObjectKey) return 'ObjectKey(${key.value})';
    if (key is GlobalKey) return 'GlobalKey';
    if (key is UniqueKey) return 'UniqueKey';
    return key.toString();
  }

  void _record(Element element) {
    final String name = element.widget.runtimeType.toString();
    final String? keyLabel = _keyLabel(element.widget.key);
    final String route = resolveRouteLabel(element);
    final String id = '$route|$name|${keyLabel ?? ''}';
    final DateTime now = DateTime.now();
    lastRoute = route;
    WidgetEntry? entry = entries[id];
    if (entry == null) {
      String? sourceFile;
      int? sourceLine;
      if (resolveSource && !isFrameworkWidgetName(name)) {
        final SourceLocation? location = resolveElementSource(element);
        if (location != null && _isAppSource(location.file)) {
          sourceFile = location.file;
          sourceLine = location.line;
        }
      }
      entry = WidgetEntry(
        id: id,
        name: name,
        route: route,
        keyLabel: keyLabel,
        sourceFile: sourceFile,
        sourceLine: sourceLine,
      );
      entries[id] = entry;
    }
    entry.session += 1;
    entry.lastSeen = now;
    if (!frozen) {
      entry.hits.add(now);
      _frameNodes[element] = _FrameNode(
        widgetId: id,
        name: name,
        route: route,
        sourceUri: entry.sourceFile,
        sourceLine: entry.sourceLine,
      );
      _scheduleFrame();
    }
  }

  void _scheduleFrame() {
    if (_frameScheduled || !active) return;
    _frameScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      _frameScheduled = false;
      _flushFrame();
    });
  }

  void _flushFrame() {
    if (_frameNodes.isEmpty) return;
    try {
      final List<Element> elements = _frameNodes.keys.toList();
      final HashMap<Element, int> index = HashMap<Element, int>.identity();
      for (var i = 0; i < elements.length; i++) {
        index[elements[i]] = i;
      }
      final List<RebuildNode> input = <RebuildNode>[];
      for (var i = 0; i < elements.length; i++) {
        final Element element = elements[i];
        final _FrameNode meta = _frameNodes[element]!;
        int? parent;
        try {
          element.visitAncestorElements((Element ancestor) {
            final int? idx = index[ancestor];
            if (idx != null) {
              parent = idx;
              return false;
            }
            return true;
          });
        } catch (_) {
          // Element may be defunct by flush time; keep it as a root.
        }
        input.add(
          RebuildNode(
            widgetId: meta.widgetId,
            name: meta.name,
            route: meta.route,
            parentIndex: parent,
            sourceUri: meta.sourceUri,
            sourceLine: meta.sourceLine,
          ),
        );
      }
      final RebuildCauseReport report = groupRebuilds(input);
      final DateTime now = DateTime.now();
      for (final RebuildCauseGroup group in report.roots) {
        final _RootWindow window = _roots.putIfAbsent(
          group.rootId,
          () => _RootWindow(
            widget: group.widget,
            route: group.route,
            sourceUri: group.sourceUri,
            sourceLine: group.sourceLine,
          ),
        );
        window.hits.add(now);
        if (group.children > window.children) window.children = group.children;
      }
      for (final AttributedRebuild a in report.attributed) {
        final _AttrWindow window = _attributed.putIfAbsent(
          '${a.widget}|${a.root}',
          () => _AttrWindow(a.widget, a.root),
        );
        for (var i = 0; i < a.count; i++) {
          window.hits.add(now);
        }
      }
    } finally {
      _frameNodes.clear();
    }
  }

  /// Rebuild roots and attributed descendants over the rolling window.
  Map<String, Object?> causes({int limit = 20}) {
    final DateTime now = DateTime.now();
    final DateTime cutoff = now.subtract(const Duration(milliseconds: _windowMs));
    for (final _RootWindow w in _roots.values) {
      w.hits.removeWhere((DateTime t) => t.isBefore(cutoff));
    }
    for (final _AttrWindow w in _attributed.values) {
      w.hits.removeWhere((DateTime t) => t.isBefore(cutoff));
    }
    _roots.removeWhere((_, _RootWindow w) => w.hits.isEmpty);
    _attributed.removeWhere((_, _AttrWindow w) => w.hits.isEmpty);

    const double windowSec = _windowMs / 1000.0;
    final List<Map<String, Object?>> roots = _roots.entries.map(
      (MapEntry<String, _RootWindow> e) {
        final _RootWindow w = e.value;
        final int count = w.hits.length;
        return <String, Object?>{
          'id': e.key,
          'widget': w.widget,
          'route': w.route,
          'cause': 'self',
          'rebuilds': count,
          'ratePerSec': double.parse((count / windowSec).toStringAsFixed(2)),
          'children': w.children,
          if (w.sourceUri != null) 'sourceUri': w.sourceUri,
          if (w.sourceLine != null) 'sourceLine': w.sourceLine,
        };
      },
    ).toList()
      ..sort(
        (Map<String, Object?> a, Map<String, Object?> b) =>
            (b['rebuilds'] as int).compareTo(a['rebuilds'] as int),
      );

    final List<Map<String, Object?>> attributed = _attributed.values
        .map(
          (_AttrWindow w) => <String, Object?>{
            'widget': w.widget,
            'root': w.root,
            'count': w.hits.length,
          },
        )
        .toList()
      ..sort(
        (Map<String, Object?> a, Map<String, Object?> b) =>
            (b['count'] as int).compareTo(a['count'] as int),
      );

    return <String, Object?>{
      'ok': true,
      'active': active,
      'windowMs': _windowMs,
      'roots': roots.take(limit).toList(),
      'attributed': attributed.take(limit).toList(),
    };
  }

  bool _isAppSource(String file) {
    final String? pkg = appPackage;
    if (pkg == null || pkg.isEmpty) return true;
    return file.contains(pkg);
  }

  void _pruneWindow(DateTime cutoff) {
    for (final WidgetEntry entry in entries.values) {
      entry.hits.removeWhere((DateTime t) => t.isBefore(cutoff));
    }
  }

  Map<String, Object?> snapshot({int limit = 40}) {
    final DateTime now = DateTime.now();
    final DateTime cutoff = now.subtract(const Duration(milliseconds: _windowMs));
    if (!frozen) {
      _pruneWindow(cutoff);
    }

    const double windowSec = _windowMs / 1000.0;
    final List<Map<String, dynamic>> widgetMaps = <Map<String, dynamic>>[];
    int totalWindow = 0;
    int totalSession = 0;

    for (final WidgetEntry entry in entries.values) {
      final int windowCount = entry.hits.length;
      totalWindow += windowCount;
      totalSession += entry.session;
      final int lastSeenMs = now.difference(entry.lastSeen).inMilliseconds;
      widgetMaps.add(<String, dynamic>{
        'id': entry.id,
        'name': entry.name,
        'route': entry.route,
        if (entry.keyLabel != null) 'keyLabel': entry.keyLabel,
        if (entry.sourceFile != null) 'sourceUri': entry.sourceFile,
        if (entry.sourceLine != null) 'sourceLine': entry.sourceLine,
        'rebuildsSession': entry.session,
        'rebuildsWindow': windowCount,
        'ratePerSec': windowCount > 0
            ? double.parse((windowCount / windowSec).toStringAsFixed(2))
            : 0.0,
        'lastSeenMs': lastSeenMs < 0 ? 0 : lastSeenMs,
        'isFramework': isFrameworkWidgetName(entry.name),
      });
    }

    widgetMaps.sort((Map<String, dynamic> a, Map<String, dynamic> b) {
      final int aw = a['rebuildsWindow'] as int;
      final int bw = b['rebuildsWindow'] as int;
      if (bw != aw) return bw.compareTo(aw);
      return (b['rebuildsSession'] as int).compareTo(a['rebuildsSession'] as int);
    });

    final List<Map<String, dynamic>> top = widgetMaps.take(limit).map(
      (Map<String, dynamic> w) {
        final int rebuilds = w['rebuildsWindow'] as int;
        return <String, dynamic>{
          ...w,
          'share': totalWindow > 0
              ? double.parse(((rebuilds / totalWindow) * 100).toStringAsFixed(1))
              : 0.0,
        };
      },
    ).toList();

    final Map<String, List<Map<String, dynamic>>> byRoute =
        <String, List<Map<String, dynamic>>>{};
    for (final Map<String, dynamic> w in top) {
      final String route = w['route'] as String;
      byRoute.putIfAbsent(route, () => <Map<String, dynamic>>[]).add(w);
    }

    final List<Map<String, dynamic>> screens = byRoute.entries.map(
      (MapEntry<String, List<Map<String, dynamic>>> e) {
        final List<Map<String, dynamic>> routeWidgets = e.value;
        final int rebuildsWindow = routeWidgets.fold<int>(
          0,
          (int a, Map<String, dynamic> w) => a + (w['rebuildsWindow'] as int),
        );
        return <String, dynamic>{
          'route': e.key,
          'rebuildsWindow': rebuildsWindow,
          'ratePerSec': rebuildsWindow > 0
              ? double.parse((rebuildsWindow / windowSec).toStringAsFixed(2))
              : 0.0,
          'share': totalWindow > 0
              ? double.parse(
                  ((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1),
                )
              : 0.0,
          'topWidgets': routeWidgets.take(5).toList(),
        };
      },
    ).toList()
      ..sort(
        (Map<String, dynamic> a, Map<String, dynamic> b) =>
            (b['rebuildsWindow'] as int).compareTo(a['rebuildsWindow'] as int),
      );

    return <String, Object?>{
      'ok': true,
      'active': active,
      'frozen': frozen,
      'windowMs': _windowMs,
      'totalRebuildsWindow': totalWindow,
      'totalRebuildsSession': totalSession,
      'totalRebuilds': totalWindow,
      'currentRoute': lastRoute,
      'widgets': top,
      'screens': screens,
    };
  }
}
