import 'package:pulseflow_bridge/pulseflow_bridge.dart';
import 'package:test/test.dart';

void main() {
  final FrameStats stats = FrameStats(
    sampleCount: 100,
    p95BuildMs: 9.5,
    p95RasterMs: 4,
    jankRatio: 0.2,
  );

  group('evaluateBudgets', () {
    test('passes when within budget', () {
      expect(
        evaluateBudgets(
          stats,
          maxP95Build: 12,
          maxP95Raster: 8,
          maxJankRatio: 0.3,
        ),
        isEmpty,
      );
    });

    test('flags each exceeded budget', () {
      final List<String> violations = evaluateBudgets(
        stats,
        maxP95Build: 8,
        maxP95Raster: 2,
        maxJankRatio: 0.1,
      );
      expect(violations, hasLength(3));
      expect(violations.first, contains('p95 build'));
    });

    test('ignores unset budgets', () {
      expect(evaluateBudgets(stats), isEmpty);
    });

    test('does not flag a ratio exactly at the limit', () {
      expect(evaluateBudgets(stats, maxJankRatio: 0.2), isEmpty);
    });
  });
}
