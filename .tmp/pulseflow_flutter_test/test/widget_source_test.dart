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

  group('looksLikeFrameworkSource', () {
    test('flags dart core, the Flutter SDK and empty paths', () {
      expect(looksLikeFrameworkSource('dart:core'), isTrue);
      expect(looksLikeFrameworkSource('package:flutter/widgets.dart'), isTrue);
      expect(
        looksLikeFrameworkSource('/opt/flutter/packages/flutter/lib/src/x.dart'),
        isTrue,
      );
      expect(looksLikeFrameworkSource(''), isTrue);
    });

    test('accepts app files', () {
      expect(looksLikeFrameworkSource('/home/me/app/lib/main.dart'), isFalse);
      expect(looksLikeFrameworkSource('package:my_app/home/page.dart'), isFalse);
    });
  });

  group('isAppSourceFile', () {
    test('requires the app package when one is configured', () {
      expect(isAppSourceFile('package:my_app/a.dart', 'my_app'), isTrue);
      expect(
        isAppSourceFile('/opt/flutter/packages/flutter/lib/src/x.dart', 'my_app'),
        isFalse,
      );
    });

    test('rejects framework sources when no package is set', () {
      expect(isAppSourceFile('package:flutter/widgets.dart', null), isFalse);
      expect(isAppSourceFile('/home/me/app/lib/main.dart', null), isTrue);
    });
  });

  group('isSourceWorthyWidgetName', () {
    test('allows app widgets, including private ones', () {
      expect(isSourceWorthyWidgetName('InvoiceCard'), isTrue);
      // Regression: private app widgets/States are common rebuild roots and must
      // keep their source (isFrameworkWidgetName would reject the leading `_`).
      expect(isSourceWorthyWidgetName('_InvoiceList'), isTrue);
      expect(isSourceWorthyWidgetName('AnimatedList'), isTrue);
    });

    test('skips known framework shells and transitions', () {
      expect(isSourceWorthyWidgetName('AnimatedBuilder'), isFalse);
      expect(isSourceWorthyWidgetName('FadeTransition'), isFalse);
      expect(isSourceWorthyWidgetName('Padding'), isFalse);
    });
  });
}
