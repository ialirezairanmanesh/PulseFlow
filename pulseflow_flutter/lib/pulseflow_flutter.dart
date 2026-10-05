/// PulseFlow app-side probes and service extensions.
///
/// Register everything from `main()`:
///
/// ```dart
/// import 'package:pulseflow_flutter/pulseflow_flutter.dart';
///
/// void main() {
///   registerPulseFlow(appPackage: 'my_app');
///   runApp(const MyApp());
/// }
/// ```
library;

export 'src/device/build_info.dart';
export 'src/device/display_info.dart';
export 'src/probes/error_probe.dart';
export 'src/probes/frame_probe.dart';
export 'src/probes/image_probe.dart';
export 'src/probes/leak_probe.dart';
export 'src/probes/network_probe.dart';
export 'src/probes/rebuild_cause.dart';
export 'src/probes/rebuild_probe.dart';
export 'src/probes/widget_source.dart';
export 'src/pulseflow_registration.dart';
export 'src/scenarios/builtin_scenarios.dart';
export 'src/state/stress_state.dart';
