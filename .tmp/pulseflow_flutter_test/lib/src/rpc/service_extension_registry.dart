import 'dart:async';
import 'dart:convert';
import 'dart:developer';

/// A handler that produces a JSON-encodable response for a `ext.pulseflow.*`
/// service extension.
typedef PulseJsonHandler = FutureOr<Map<String, Object?>> Function(
  Map<String, String> params,
);

/// Registers [handler] as a PulseFlow service extension, wrapping it with a
/// JSON envelope and consistent error reporting.
void registerPulseExtension(String name, PulseJsonHandler handler) {
  registerExtension(name, (String method, Map<String, String> params) async {
    try {
      return ServiceExtensionResponse.result(jsonEncode(await handler(params)));
    } catch (error) {
      return ServiceExtensionResponse.error(
        ServiceExtensionResponse.extensionError,
        '$error',
      );
    }
  });
}

/// Reads an integer parameter, falling back to [fallback] when absent or
/// malformed.
int intParam(Map<String, String> params, String key, int fallback) {
  final Object? raw = params[key];
  if (raw == null) return fallback;
  return int.tryParse(raw.toString()) ?? fallback;
}

/// Reads a double parameter, falling back to [fallback] when absent or
/// malformed.
double doubleParam(Map<String, String> params, String key, double fallback) {
  final Object? raw = params[key];
  if (raw == null) return fallback;
  return double.tryParse(raw.toString()) ?? fallback;
}
