import 'package:flutter/widgets.dart';

/// Sentinel used when no route/screen label can be resolved.
const String kUnnamedRoute = '(unnamed)';

/// Returns true when [name] looks like an app-level screen/page widget.
@visibleForTesting
bool isUsefulScreenName(String name) {
  if (name.isEmpty || name.startsWith('_')) return false;
  // Generic navigator / host shells — not useful as a "page".
  const Set<String> skip = <String>{
    'MaterialApp',
    'CupertinoApp',
    'WidgetsApp',
    'Navigator',
    'Overlay',
    'OverlayEntry',
    'Scaffold',
    'Material',
    'CupertinoPageScaffold',
    'HeroControllerScope',
    'UnmanagedRestorationScope',
    'RestorationScope',
    'Title',
    'CheckedModeBanner',
    'Banner',
    'Directionality',
    'Localizations',
    'MediaQuery',
    'FocusScope',
    'Focus',
    'Actions',
    'Shortcuts',
    'DefaultTextStyle',
    'IconTheme',
    'Theme',
    'CupertinoTheme',
    'ScrollConfiguration',
    'NotificationListener',
    'Semantics',
    'ExcludeSemantics',
    'Builder',
    'KeyedSubtree',
    'RepaintBoundary',
    'TickerMode',
    'AnimatedBuilder',
    'AnimatedWidget',
    'ListenableBuilder',
    'ValueListenableBuilder',
    'StreamBuilder',
    'FutureBuilder',
  };
  if (skip.contains(name)) return false;
  return RegExp(
    r'(Page|Screen|View|Route|Tab|Dashboard|Home|Sheet|Dialog)$',
  ).hasMatch(name);
}

String? _namedFromModal(Element element) {
  try {
    final ModalRoute<dynamic>? modal = ModalRoute.of(element);
    if (modal == null) return null;

    final String? name = modal.settings.name;
    if (name != null && name.isNotEmpty) return name;

    final RouteSettings settings = modal.settings;
    if (settings is Page<dynamic>) {
      final String? pageName = settings.name;
      if (pageName != null && pageName.isNotEmpty) return pageName;
      final String pageType = settings.runtimeType.toString();
      if (isUsefulScreenName(pageType)) return pageType;
    }
  } catch (_) {
    // Element may not be mounted under a modal route.
  }
  return null;
}

/// Current URI path from [Router] (go_router / MaterialApp.router).
String? _locationFromRouter(Element element) {
  try {
    final Router<dynamic>? router = Router.maybeOf(element);
    final RouteInformationProvider? provider = router?.routeInformationProvider;
    if (provider == null) return null;
    final String path = provider.value.uri.path;
    return path.isEmpty ? '/' : path;
  } catch (_) {
    return null;
  }
}

String? _nearestScreenName(Element element) {
  String? found;
  try {
    element.visitAncestorElements((Element ancestor) {
      final String name = ancestor.widget.runtimeType.toString();
      if (isUsefulScreenName(name)) {
        found = name;
        return false;
      }
      return true;
    });
  } catch (_) {
    // Defunct element.
  }
  return found;
}

/// Resolves a human-readable route/screen label for a rebuilt [element].
///
/// Order:
/// 1. Specific [ModalRoute.settings.name] / [Page.name] (not bare `/`)
/// 2. Specific [Router] URI path (go_router / `MaterialApp.router`)
/// 3. Nearest ancestor whose type looks like a Page/Screen/View
/// 4. Bare `/` from the navigator/router, if that is all we have
/// 5. [kUnnamedRoute]
String resolveRouteLabel(Element element) {
  final String? named = _namedFromModal(element);
  final String? fromRouter = _locationFromRouter(element);
  final String? screen = _nearestScreenName(element);

  // Bare "/" is what MaterialApp uses for `home` — prefer a Page/Screen name.
  if (named != null && named != '/') return named;
  if (fromRouter != null && fromRouter != '/') return fromRouter;
  if (screen != null) return screen;
  if (named != null) return named;
  if (fromRouter != null) return fromRouter;

  return kUnnamedRoute;
}

/// Live Navigator/Router location without needing a recent rebuild.
///
/// Prefers a specific modal name, then a Router URI path (not bare `/`).
/// Deeper tree hits overwrite shallow `/` home routes.
String? detectLiveRoute() {
  try {
    final Element? root = WidgetsBinding.instance.rootElement;
    if (root == null) return null;

    final List<String> modals = <String>[];
    final List<String> routers = <String>[];
    void visitor(Element el) {
      final String? named = _namedFromModal(el);
      if (named != null && named.isNotEmpty) modals.add(named);
      final String? path = _locationFromRouter(el);
      if (path != null && path.isNotEmpty) routers.add(path);
      el.visitChildren(visitor);
    }

    root.visitChildren(visitor);

    String? pick(List<String> values) {
      if (values.isEmpty) return null;
      for (var i = values.length - 1; i >= 0; i--) {
        if (values[i] != '/') return values[i];
      }
      return values.last;
    }

    return pick(modals) ?? pick(routers);
  } catch (_) {
    return null;
  }
}
