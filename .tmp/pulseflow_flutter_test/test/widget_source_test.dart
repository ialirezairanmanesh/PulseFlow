import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  group('parseCreationLocation', () {
    test('parses file and integer line', () {
      final SourceLocation? location = parseCreationLocation(
        <String, Object?>{'file': 'package:app/main.dart', 'line': 42},
      );
      expect(location, isNotNull);
      expect(location!.file, 'package:app/main.dart');
      expect(location.line, 42);
    });

    test('parses a string line', () {
      final SourceLocation? location = parseCreationLocation(
        <String, Object?>{'file': 'package:app/x.dart', 'line': '7'},
      );
      expect(location!.line, 7);
    });

    test('returns null when file is missing or input is not a map', () {
      expect(parseCreationLocation(<String, Object?>{'line': 3}), isNull);
      expect(parseCreationLocation(null), isNull);
      expect(parseCreationLocation('nope'), isNull);
    });

    test('toString renders file:line', () {
      expect(
        const SourceLocation(file: 'a.dart', line: 1).toString(),
        'a.dart:1',
      );
    });
  });
}
