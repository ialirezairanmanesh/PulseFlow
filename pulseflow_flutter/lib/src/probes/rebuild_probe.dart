import 'package:flutter/widgets.dart';

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
  'IconTheme',
  'Theme',
  'Material',
  'Scaffold',
  'GestureDetector',
  'MouseRegion',
  'Focus',
  'FocusScope',
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
  'NotificationListener',
  'ScrollConfiguration',
  'RawGestureDetector',
  'Actions',
  'Shortcuts',
  'Localizations',
  'Title',
  'Banner',
  'CheckedModeBanner',
};

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

  RebuildDirtyWidgetCallback? _previous;
  final Map<String, WidgetEntry> entries = <String, WidgetEntry>{};

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
    String route = '(unnamed)';
    try {
      final ModalRoute<dynamic>? modal = ModalRoute.of(element);
      final String? nameSetting = modal?.settings.name;
      if (nameSetting != null && nameSetting.isNotEmpty) {
        route = nameSetting;
      }
    } catch (_) {
      // Element may not be mounted in a route.
    }
    final String id = '$route|$name|${keyLabel ?? ''}';
    final DateTime now = DateTime.now();
    WidgetEntry? entry = entries[id];
    if (entry == null) {
      String? sourceFile;
      int? sourceLine;
      if (resolveSource && !_frameworkWidgets.contains(name)) {
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
    }
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
        'isFramework': _frameworkWidgets.contains(entry.name),
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
      'widgets': top,
      'screens': screens,
    };
  }
}
