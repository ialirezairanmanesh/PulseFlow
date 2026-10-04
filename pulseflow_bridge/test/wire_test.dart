import 'package:pulseflow_bridge/pulseflow_bridge.dart';
import 'package:test/test.dart';

void main() {
  group('framePressure', () {
    test('is minimal for a fast frame', () {
      expect(framePressure(2, 2, 4), 16.8);
    });

    test('caps at 100 for a very slow frame', () {
      expect(framePressure(80, 40, 120), 100.0);
    });

    test('respects a custom 120Hz budget', () {
      final double slow = framePressure(5, 4, 9, budgetMs: 8.33);
      final double fast = framePressure(5, 4, 9);
      expect(slow, greaterThan(fast));
    });
  });

  group('usToMs', () {
    test('converts microseconds', () {
      expect(usToMs(16670), closeTo(16.67, 0.01));
    });

    test('guards tiny and invalid values', () {
      expect(usToMs(0), 0);
      expect(usToMs(-5), 0);
    });
  });

  test('round2 keeps two decimals', () {
    expect(round2(16.6666), 16.67);
  });
}
