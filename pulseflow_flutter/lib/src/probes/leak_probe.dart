import 'package:flutter/foundation.dart';

/// Counts outstanding (created-but-not-disposed) objects reported by
/// [FlutterMemoryAllocations].
///
/// This is the runtime primitive `leak_tracker` is built on; using it directly
/// keeps the package dependency-free. Only available when Flutter instruments
/// memory allocations (debug builds by default).
class LeakProbe {
  LeakProbe._();

  static final LeakProbe instance = LeakProbe._();

  final Map<String, int> _created = <String, int>{};
  final Map<String, int> _disposed = <String, int>{};
  bool _active = false;
  int _createdTotal = 0;
  int _disposedTotal = 0;

  bool get active => _active;

  void start() {
    if (_active) return;
    if (!kFlutterMemoryAllocationsEnabled) return;
    _active = true;
    FlutterMemoryAllocations.instance.addListener(_onEvent);
  }

  void stop() {
    if (!_active) return;
    _active = false;
    FlutterMemoryAllocations.instance.removeListener(_onEvent);
  }

  void reset() {
    _created.clear();
    _disposed.clear();
    _createdTotal = 0;
    _disposedTotal = 0;
  }

  void _onEvent(ObjectEvent event) {
    if (event is ObjectCreated) {
      _created[event.className] = (_created[event.className] ?? 0) + 1;
      _createdTotal += 1;
    } else if (event is ObjectDisposed) {
      final String name = event.object.runtimeType.toString();
      _disposed[name] = (_disposed[name] ?? 0) + 1;
      _disposedTotal += 1;
    }
  }

  Map<String, Object?> report({int threshold = 1, int limit = 30}) {
    if (!kFlutterMemoryAllocationsEnabled) {
      return <String, Object?>{
        'ok': true,
        'available': false,
        'message': 'Memory allocations are not instrumented in this build',
      };
    }
    final List<Map<String, Object?>> leaked = <Map<String, Object?>>[];
    _created.forEach((String name, int created) {
      final int outstanding = created - (_disposed[name] ?? 0);
      if (outstanding >= threshold) {
        leaked.add(<String, Object?>{'className': name, 'count': outstanding});
      }
    });
    leaked.sort(
      (Map<String, Object?> a, Map<String, Object?> b) =>
          (b['count'] as int).compareTo(a['count'] as int),
    );
    return <String, Object?>{
      'ok': true,
      'available': true,
      'active': _active,
      'createdTotal': _createdTotal,
      'disposedTotal': _disposedTotal,
      'leaked': leaked.take(limit).toList(),
    };
  }
}
