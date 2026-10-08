import 'dart:ui' show Display;

import 'package:flutter/widgets.dart';

/// Refresh-rate information for the active display.
class DisplayInfo {
  const DisplayInfo({required this.refreshRate, required this.budgetMs});

  /// Frames per second reported by the platform (falls back to 60).
  final double refreshRate;

  /// Per-frame budget in milliseconds (`1000 / refreshRate`).
  final double budgetMs;

  Map<String, Object?> toJson() => <String, Object?>{
        'refreshRate': refreshRate,
        'budgetMs': budgetMs,
      };
}

/// Resolves the primary display refresh rate, defaulting to 60 Hz when the
/// platform does not report one.
DisplayInfo resolveDisplayInfo() {
  double rate = 60;
  try {
    final Iterable<Display> displays =
        WidgetsBinding.instance.platformDispatcher.displays;
    if (displays.isNotEmpty) {
      final double reported = displays.first.refreshRate;
      if (reported.isFinite && reported > 0) {
        rate = reported;
      }
    }
  } catch (_) {
    // Platform did not expose displays; keep the 60 Hz default.
  }
  return DisplayInfo(refreshRate: rate, budgetMs: 1000 / rate);
}
