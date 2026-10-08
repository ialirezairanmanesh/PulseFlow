import 'dart:ui' show FlutterView;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'build_info.dart';
import 'display_info.dart';

/// Optional app-supplied enricher for [DeviceContext.snapshot].
///
/// Use this to attach battery %, connectivity, app version, etc. without
/// forcing plugin dependencies into `pulseflow_flutter`:
///
/// ```dart
/// DeviceContext.instance.enricher = () async => <String, Object?>{
///   'appVersion': packageInfo.version,
///   'batteryPercent': battery.batteryLevel,
///   'connectivity': connectivity.name,
/// };
/// ```
typedef DeviceContextEnricher = Future<Map<String, Object?>> Function();

/// Collects lightweight device / runtime context for PulseFlow.
class DeviceContext {
  DeviceContext._();

  static final DeviceContext instance = DeviceContext._();

  /// Package name passed to [registerPulseFlow], when set.
  String? appPackage;

  /// Optional async enricher merged into every snapshot under `extras`.
  DeviceContextEnricher? enricher;

  /// Builds a JSON-encodable device context map.
  Future<Map<String, Object?>> snapshot() async {
    final DisplayInfo display = resolveDisplayInfo();
    final FlutterView? view =
        WidgetsBinding.instance.platformDispatcher.views.firstOrNull;
    final Locale locale =
        WidgetsBinding.instance.platformDispatcher.locale;
    final double textScale =
        WidgetsBinding.instance.platformDispatcher.textScaleFactor;

    Map<String, Object?> extras = <String, Object?>{};
    final DeviceContextEnricher? enrich = enricher;
    if (enrich != null) {
      try {
        extras = await enrich();
      } catch (error) {
        extras = <String, Object?>{'enricherError': '$error'};
      }
    }

    return <String, Object?>{
      'ok': true,
      'platform': _platformLabel(),
      'buildMode': currentBuildMode(),
      'locale': locale.toLanguageTag(),
      'textScale': double.parse(textScale.toStringAsFixed(2)),
      if (appPackage != null) 'appPackage': appPackage,
      'display': <String, Object?>{
        ...display.toJson(),
        if (view != null) ...<String, Object?>{
          'devicePixelRatio': view.devicePixelRatio,
          'physicalWidth': view.physicalSize.width,
          'physicalHeight': view.physicalSize.height,
        },
      },
      if (extras.isNotEmpty) 'extras': extras,
    };
  }

  static String _platformLabel() {
    if (kIsWeb) return 'web';
    return defaultTargetPlatform.name;
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull {
    final Iterator<E> it = iterator;
    if (it.moveNext()) return it.current;
    return null;
  }
}
