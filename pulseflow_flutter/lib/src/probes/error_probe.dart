import 'package:flutter/foundation.dart';

/// Classifies an error for the dashboard: `overflow`, `assert`, or `exception`.
String classifyError(Object error) {
  final String text = error.toString().toLowerCase();
  if (text.contains('overflowed')) return 'overflow';
  if (error is AssertionError) return 'assert';
  return 'exception';
}

/// A short, stable signature for grouping errors (first line, capped).
String errorSignature(Object error) {
  final String first = error.toString().split('\n').first.trim();
  if (first.isEmpty) return 'Unknown error';
  return first.length > 160 ? first.substring(0, 160) : first;
}

/// Returns the route to attribute new errors to (usually the last rebuilt route).
typedef RouteProvider = String? Function();

class _ErrorEntry {
  _ErrorEntry({required this.signature, required this.kind});

  final String signature;
  String kind;
  int count = 0;
  String? lastMessage;
  String? route;
  List<String> top = const <String>[];

  Map<String, Object?> toJson() => <String, Object?>{
        'kind': kind,
        'signature': signature,
        'count': count,
        if (lastMessage != null) 'lastMessage': lastMessage,
        if (route != null) 'route': route,
        'top': top,
      };
}

/// Captures framework errors, overflow, and uncaught async errors.
///
/// Always chains the previous `FlutterError.onError` so crash dumps are not
/// suppressed. Debug/profile only.
class ErrorProbe {
  ErrorProbe._();

  static final ErrorProbe instance = ErrorProbe._();

  bool _active = false;
  FlutterExceptionHandler? _previousOnError;
  final Map<String, _ErrorEntry> _errors = <String, _ErrorEntry>{};
  int _total = 0;

  /// Optional provider for the current route (wired to the rebuild probe).
  RouteProvider? routeProvider;

  bool get active => _active;

  void start() {
    if (_active) return;
    if (kReleaseMode) return;
    _active = true;
    _previousOnError = FlutterError.onError;
    FlutterError.onError = _onFlutterError;
    PlatformDispatcher.instance.onError = _onPlatformError;
  }

  void stop() {
    if (!_active) return;
    _active = false;
    FlutterError.onError = _previousOnError;
    _previousOnError = null;
    PlatformDispatcher.instance.onError = null;
  }

  void reset() {
    _errors.clear();
    _total = 0;
  }

  void _record(Object error, StackTrace? stack, {String? kind}) {
    _total += 1;
    final String signature = errorSignature(error);
    final _ErrorEntry entry = _errors.putIfAbsent(
      signature,
      () => _ErrorEntry(signature: signature, kind: kind ?? classifyError(error)),
    );
    entry.kind = kind ?? entry.kind;
    entry.count += 1;
    entry.lastMessage = error.toString();
    final String? route = routeProvider?.call();
    if (route != null) entry.route = route;
    entry.top = _topFrames(stack);
    while (_errors.length > 40) {
      _errors.remove(_errors.keys.first);
    }
  }

  List<String> _topFrames(StackTrace? stack) {
    if (stack == null) return const <String>[];
    return stack
        .toString()
        .split('\n')
        .where((String line) => line.trim().isNotEmpty)
        .take(3)
        .map((String line) => line.trim())
        .toList();
  }

  void _onFlutterError(FlutterErrorDetails details) {
    _record(details.exception, details.stack);
    _previousOnError?.call(details);
  }

  bool _onPlatformError(Object error, StackTrace stack) {
    _record(error, stack, kind: 'async');
    return false;
  }

  Map<String, Object?> snapshot({int limit = 40}) {
    if (kReleaseMode) {
      return <String, Object?>{
        'ok': true,
        'available': false,
        'message': 'Errors are only tracked in debug/profile builds',
      };
    }
    final List<_ErrorEntry> errors = _errors.values.toList()
      ..sort((_ErrorEntry a, _ErrorEntry b) => b.count.compareTo(a.count));
    return <String, Object?>{
      'ok': true,
      'available': true,
      'active': _active,
      'total': _total,
      'errors': errors.take(limit).map((_ErrorEntry e) => e.toJson()).toList(),
    };
  }
}
