import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('resolveDisplayInfo defaults to 60Hz with a ~16.67ms budget', () {
    final DisplayInfo info = resolveDisplayInfo();
    expect(info.refreshRate, 60);
    expect(info.budgetMs, closeTo(16.667, 0.01));
  });

  test('DisplayInfo serializes refresh rate and budget', () {
    const DisplayInfo info = DisplayInfo(refreshRate: 120, budgetMs: 8.333);
    expect(info.toJson(), <String, Object?>{
      'refreshRate': 120,
      'budgetMs': 8.333,
    });
  });
}
