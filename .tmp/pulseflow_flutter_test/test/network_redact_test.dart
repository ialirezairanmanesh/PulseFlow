import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  test('redacts sensitive query params and user info', () {
    final String redacted = redactUri(
      Uri.parse(
        'https://user:secret@api.example.com/v1?token=abc&q=ok&api_key=xyz',
      ),
    );
    expect(redacted, contains('***@'));
    expect(redacted, isNot(contains('user:secret')));
    expect(redacted, contains('token=***'));
    expect(redacted, contains('api_key=***'));
    expect(redacted, contains('q=ok'));
    expect(redacted, isNot(contains('token=abc')));
  });

  test('leaves clean URIs unchanged', () {
    const String raw = 'https://example.com/path?page=1';
    expect(redactUri(Uri.parse(raw)), raw);
  });
}
