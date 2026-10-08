import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  group('classifyError', () {
    test('detects overflow', () {
      expect(
        classifyError(FlutterError('A RenderFlex overflowed by 24 pixels on the right.')),
        'overflow',
      );
    });

    test('detects assertions', () {
      expect(classifyError(AssertionError('bad state')), 'assert');
    });

    test('defaults to exception', () {
      expect(classifyError(Exception('boom')), 'exception');
    });
  });

  group('errorSignature', () {
    test('uses the first line', () {
      expect(errorSignature(Exception('a\nb\nc')), 'Exception: a');
    });

    test('caps very long messages', () {
      final String long = 'E' * 400;
      expect(errorSignature(Exception(long)).length, 160);
    });
  });
}
