import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  group('isOversizedImage', () {
    test('flags a large decode overhead', () {
      // 4 MB decoded, 64 KB displayed → clearly oversized.
      expect(isOversizedImage(4 * 1024 * 1024, 64 * 1024), isTrue);
    });

    test('ignores a small overhead', () {
      expect(isOversizedImage(200 * 1024, 150 * 1024), isFalse);
    });

    test('respects a custom threshold', () {
      expect(
        isOversizedImage(200 * 1024, 150 * 1024, thresholdBytes: 10 * 1024),
        isTrue,
      );
    });

    test('never flags when displayed as large as decoded', () {
      expect(isOversizedImage(64 * 1024, 64 * 1024), isFalse);
    });
  });
}
