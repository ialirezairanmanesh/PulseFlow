import 'package:flutter/foundation.dart';

/// The current Flutter build mode as a string: `debug`, `profile`, or `release`.
String currentBuildMode() {
  if (kReleaseMode) return 'release';
  if (kProfileMode) return 'profile';
  return 'debug';
}

/// Which probes can produce data in the current build mode.
///
/// Rebuild tracking and source locations rely on debug-only framework hooks
/// (`debugOnRebuildDirtyWidget`, widget-creation tracking), so they are
/// unavailable in profile/release. Errors and image tracking work in
/// debug/profile. Leak tracking depends on Flutter's memory-allocation
/// instrumentation (debug by default).
Map<String, bool> probeAvailability() {
  final bool debug = kDebugMode;
  final bool notRelease = !kReleaseMode;
  return <String, bool>{
    'rebuildProbe': debug,
    'sourceLocations': debug,
    'errors': notRelease,
    'images': notRelease,
    'leaks': kFlutterMemoryAllocationsEnabled,
    'stalls': notRelease,
    'deviceContext': true,
  };
}
