import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// A source file + 1-based line where a widget was created.
@immutable
class SourceLocation {
  const SourceLocation({required this.file, required this.line});

  final String file;
  final int line;

  Map<String, Object?> toJson() => <String, Object?>{'file': file, 'line': line};

  @override
  String toString() => '$file:$line';
}

/// Parses the `creationLocation` object produced by [WidgetInspectorService].
///
/// Kept pure so it can be unit-tested without an app binding.
SourceLocation? parseCreationLocation(Object? raw) {
  if (raw is! Map) return null;
  final Object? file = raw['file'];
  final Object? line = raw['line'];
  if (file is! String || file.isEmpty) return null;
  final int parsedLine = line is int ? line : (int.tryParse('$line') ?? 0);
  return SourceLocation(file: file, line: parsedLine);
}

/// True when [file] looks like the Flutter SDK or dart core, not app code.
///
/// Fallback used when `appPackage` is not configured, so rebuild roots that are
/// private framework widgets do not surface `/flutter/packages/flutter/...`.
bool looksLikeFrameworkSource(String file) {
  if (file.isEmpty) return true;
  if (file.startsWith('dart:')) return true;
  if (file.startsWith('package:flutter/')) return true;
  return file.contains('/flutter/packages/flutter');
}

/// Whether [file] belongs to the app. With an [appPackage] the file must contain
/// it; otherwise framework/dart sources are rejected.
bool isAppSourceFile(String file, String? appPackage) {
  final String? pkg = appPackage;
  if (pkg != null && pkg.isNotEmpty) return file.contains(pkg);
  return !looksLikeFrameworkSource(file);
}

/// Returns the source location of [element], or `null` when unavailable.
///
/// Only works in debug/profile builds that track widget creation locations
/// (the default for `flutter run`). Uses a disposable inspector group so it
/// does not retain elements.
SourceLocation? resolveElementSource(
  Element element, {
  String group = 'pulseflow',
}) {
  if (!kDebugMode && !kProfileMode) return null;
  final WidgetInspectorService service = WidgetInspectorService.instance;
  try {
    if (!service.isWidgetCreationTracked()) return null;
    // ignore: invalid_use_of_protected_member
    final String? id = service.toId(element, group);
    if (id == null) return null;
    try {
      final String json = service.getDetailsSubtree(id, group, subtreeDepth: 0);
      final Object? decoded = jsonDecode(json);
      if (decoded is Map) {
        return parseCreationLocation(decoded['creationLocation']);
      }
      return null;
    } finally {
      // ignore: invalid_use_of_protected_member
      service.disposeId(id, group);
    }
  } catch (_) {
    return null;
  }
}
