import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart' show kReleaseMode;

import 'device/build_info.dart';
import 'device/device_context.dart';
import 'probes/error_probe.dart';
import 'probes/frame_probe.dart';
import 'probes/image_probe.dart';
import 'probes/leak_probe.dart';
import 'probes/network_probe.dart';
import 'probes/rebuild_probe.dart';
import 'probes/stall_probe.dart';
import 'rpc/service_extension_registry.dart';
import 'scenarios/scenario_registry.dart';
import 'scenarios/scenario_runner.dart';
import 'state/stress_state.dart';

bool _registered = false;

/// Whether the PulseFlow service extensions have been registered.
bool get isPulseFlowRegistered => _registered;

/// Starts PulseFlow's in-app probes and registers the `ext.pulseflow.*`
/// service extensions.
///
/// Call once from `main()` before `runApp`, then hot-restart and Connect from
/// the PulseFlow dashboard:
///
/// ```dart
/// void main() {
///   registerPulseFlow(appPackage: 'my_app');
///   runApp(const MyApp());
/// }
/// ```
///
/// - [appPackage]: when set, widget source locations are restricted to files
///   inside this package.
/// - [captureFrames]: capture engine frame timings (recommended).
/// - [captureNetwork]: install the `HttpOverrides` network capture.
/// - [trackLeaks]: subscribe to `FlutterMemoryAllocations` (debug builds).
/// - [trackStalls]: detect main-isolate freezes above [stallThreshold].
void registerPulseFlow({
  String? appPackage,
  bool captureFrames = true,
  bool captureNetwork = true,
  bool trackLeaks = true,
  bool trackErrors = true,
  bool trackImages = true,
  bool trackStalls = true,
  Duration stallThreshold = const Duration(milliseconds: 250),
  DeviceContextEnricher? deviceEnricher,
}) {
  if (captureFrames) {
    FrameProbe.instance.start();
  }
  RebuildProbe.instance.appPackage = appPackage;
  DeviceContext.instance.appPackage = appPackage;
  if (deviceEnricher != null) {
    DeviceContext.instance.enricher = deviceEnricher;
  }
  if (captureNetwork) {
    NetworkProbe.instance.install();
  }
  if (trackLeaks) {
    LeakProbe.instance.start();
  }
  if (trackErrors) {
    ErrorProbe.instance.routeProvider = () => RebuildProbe.instance.lastRoute;
    ErrorProbe.instance.start();
  }
  if (trackImages) {
    ImageProbe.instance.start();
  }
  if (trackStalls) {
    StallProbe.instance.routeProvider = () => RebuildProbe.instance.lastRoute;
    StallProbe.instance.start(threshold: stallThreshold);
  }
  if (_registered) return;
  _registered = true;
  _registerExtensions();
}

void _registerExtensions() {
  // --- Frame timing (accurate) ---
  registerPulseExtension('ext.pulseflow.getFrameStats', (
    Map<String, String> params,
  ) {
    return <String, Object?>{
      ...FrameProbe.instance.snapshot(limit: intParam(params, 'limit', 120)),
      'buildMode': currentBuildMode(),
      'probes': probeAvailability(),
    };
  });

  // --- Device / runtime context ---
  registerPulseExtension('ext.pulseflow.getDeviceContext', (
    Map<String, String> params,
  ) async {
    return DeviceContext.instance.snapshot();
  });

  // --- UI stall / freeze ---
  registerPulseExtension('ext.pulseflow.getStallReport', (
    Map<String, String> params,
  ) {
    return StallProbe.instance.report(limit: intParam(params, 'limit', 40));
  });

  registerPulseExtension('ext.pulseflow.resetStallProbe', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Stall probe');
    StallProbe.instance.reset();
    return <String, Object?>{'ok': true, 'reset': true};
  });

  // --- Widget rebuild probe ---
  registerPulseExtension('ext.pulseflow.startWidgetProbe', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Widget probe');
    RebuildProbe.instance.start();
    return <String, Object?>{'ok': true, 'active': true};
  });

  registerPulseExtension('ext.pulseflow.stopWidgetProbe', (
    Map<String, String> params,
  ) {
    RebuildProbe.instance.stop();
    return <String, Object?>{'ok': true, 'active': false};
  });

  registerPulseExtension('ext.pulseflow.resetWidgetProbe', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Widget probe');
    if (!RebuildProbe.instance.active) RebuildProbe.instance.start();
    RebuildProbe.instance.reset();
    return <String, Object?>{'ok': true, 'active': true, 'reset': true};
  });

  registerPulseExtension('ext.pulseflow.setWidgetProbeFrozen', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Widget probe');
    if (!RebuildProbe.instance.active) RebuildProbe.instance.start();
    final bool frozen = params['frozen']?.toString().toLowerCase() == 'true';
    RebuildProbe.instance.setFrozen(frozen);
    return <String, Object?>{'ok': true, 'active': true, 'frozen': frozen};
  });

  registerPulseExtension('ext.pulseflow.getHotWidgets', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Widget probe');
    if (!RebuildProbe.instance.active) RebuildProbe.instance.start();
    return RebuildProbe.instance.snapshot(limit: intParam(params, 'limit', 500));
  });

  registerPulseExtension('ext.pulseflow.getRebuildCauses', (
    Map<String, String> params,
  ) {
    if (kReleaseMode) return _releaseOnly('Rebuild cause probe');
    if (!RebuildProbe.instance.active) RebuildProbe.instance.start();
    return RebuildProbe.instance.causes(limit: intParam(params, 'limit', 20));
  });

  // --- Network capture ---
  registerPulseExtension('ext.pulseflow.getNetworkLog', (
    Map<String, String> params,
  ) {
    return <String, Object?>{
      'ok': true,
      'available': NetworkProbe.instance.installed,
      'requests': NetworkProbe.instance.drain(limit: intParam(params, 'limit', 200)),
    };
  });

  // --- Leak signals ---
  registerPulseExtension('ext.pulseflow.getLeakReport', (
    Map<String, String> params,
  ) {
    return LeakProbe.instance.report(
      threshold: intParam(params, 'threshold', 1),
      limit: intParam(params, 'limit', 30),
    );
  });

  // --- Errors ---
  registerPulseExtension('ext.pulseflow.getErrors', (
    Map<String, String> params,
  ) {
    return ErrorProbe.instance.snapshot(limit: intParam(params, 'limit', 40));
  });

  // --- Images & assets ---
  registerPulseExtension('ext.pulseflow.getImageStats', (
    Map<String, String> params,
  ) {
    return ImageProbe.instance.snapshot(limit: intParam(params, 'limit', 30));
  });

  // --- Stress actions ---
  registerPulseExtension('ext.pulseflow.injectInvoices', (
    Map<String, String> params,
  ) {
    final int count = intParam(params, 'count', 100);
    final Random rng = Random();
    for (var i = 0; i < count; i++) {
      PulseFlowStressState.instance.invoices.add(<String, dynamic>{
        'id': 'INV-${DateTime.now().microsecondsSinceEpoch}-$i',
        'total': rng.nextDouble() * 500,
        'lines': List<String>.generate(8, (int j) => 'Item $j'),
      });
    }
    return <String, Object?>{'ok': true, 'injected': count};
  });

  registerPulseExtension('ext.pulseflow.spikeCpu', (
    Map<String, String> params,
  ) {
    final int millis = intParam(params, 'millis', 800);
    final Stopwatch sw = Stopwatch()..start();
    var acc = 0.0;
    while (sw.elapsedMilliseconds < millis) {
      acc += sin(sw.elapsedMicroseconds.toDouble());
    }
    return <String, Object?>{'ok': true, 'acc': acc};
  });

  registerPulseExtension('ext.pulseflow.allocateMemory', (
    Map<String, String> params,
  ) {
    final int megabytes = intParam(params, 'megabytes', 32);
    PulseFlowStressState.instance.retainedBuffers
        .add(List<int>.filled(megabytes * 1024 * 1024, 1));
    return <String, Object?>{'ok': true, 'megabytes': megabytes};
  });

  // --- Scenarios ---
  registerPulseExtension('ext.pulseflow.listScenarios', (
    Map<String, String> params,
  ) {
    return <String, Object?>{
      'ok': true,
      'scenarios': ScenarioRegistry.instance
          .listAll()
          .map((s) => s.toJson())
          .toList(),
    };
  });

  registerPulseExtension('ext.pulseflow.runScenario', (
    Map<String, String> params,
  ) async {
    final String id = params['id']?.toString() ?? '';
    if (id.isEmpty) {
      return <String, Object?>{'ok': false, 'reason': 'id required'};
    }
    final Map<String, String> scenarioParams = _scenarioParams(params);
    return ScenarioRunner.instance.run(id, scenarioParams);
  });

  registerPulseExtension('ext.pulseflow.stopScenario', (
    Map<String, String> params,
  ) {
    return ScenarioRunner.instance.stop();
  });
}

Map<String, Object?> _releaseOnly(String what) => <String, Object?>{
      'ok': false,
      'reason': '$what is only available in debug/profile builds',
    };

Map<String, String> _scenarioParams(Map<String, String> params) {
  final Map<String, String> out = <String, String>{};
  final String? raw = params['params'];
  if (raw != null && raw.isNotEmpty) {
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map) {
        decoded.forEach((Object? k, Object? v) {
          out[k.toString()] = v.toString();
        });
      }
    } catch (_) {
      // Ignore malformed params.
    }
  }
  params.forEach((String k, String v) {
    if (k != 'id' && k != 'params' && k != 'isolateId') {
      out[k] = v;
    }
  });
  return out;
}
