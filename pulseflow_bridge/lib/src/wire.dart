import 'dart:convert';

/// Small helpers shared by the bridge.

/// Default frame budget for 60 Hz displays, used when a probe is unavailable.
const double defaultFrameBudgetMs = 1000 / 60;

/// Encodes [payload] to JSON, tolerating non-encodable leaves.
String encodeJson(Object? payload) => jsonEncode(payload);

/// Sends a JSON-encodable payload through [sink], ignoring failures.
void sendJson(void Function(String) sink, Map<String, Object?> payload) {
  try {
    sink(encodeJson(payload));
  } catch (_) {
    // Socket closed mid-send — safe to ignore.
  }
}

/// Converts a microsecond value to milliseconds, guarding already-ms values.
double usToMs(num us) {
  if (!us.isFinite || us <= 0) return 0;
  return us > 200 ? us / 1000 : us.toDouble();
}

/// Estimates frame pressure (0..100) from frame cost against the budget.
double framePressure(
  double buildMs,
  double rasterMs,
  double frameMs, {
  double budgetMs = defaultFrameBudgetMs,
}) {
  final double cost =
      frameMs > buildMs + rasterMs ? frameMs : buildMs + rasterMs;
  final double raw = (cost / budgetMs) * 70;
  final double clamped = raw < 1 ? 1 : (raw > 100 ? 100 : raw);
  return double.parse(clamped.toStringAsFixed(1));
}

/// Rounds to two decimals.
double round2(num value) => double.parse(value.toStringAsFixed(2));
