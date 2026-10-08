import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('records engine frame timings', () {
    final FrameProbe probe = FrameProbe.instance;
    probe.reset();
    probe.debugAddTimings(<FrameTiming>[
      FrameTiming(
        vsyncStart: 0,
        buildStart: 1000,
        buildFinish: 5000,
        rasterStart: 5000,
        rasterFinish: 10000,
        rasterFinishWallTime: 11000,
      ),
    ]);

    final Map<String, Object?> snapshot = probe.snapshot();
    expect(snapshot['count'], 1);
    final Map<Object?, Object?> frame =
        (snapshot['frames']! as List<Object?>).single! as Map<Object?, Object?>;
    expect(frame['buildMs'], 4.0);
    expect(frame['rasterMs'], 5.0);
    expect(frame['vsyncMs'], 1.0);
  });

  test('snapshot reports p95 percentiles', () {
    final FrameProbe probe = FrameProbe.instance;
    probe.reset();
    probe.debugAddTimings(<FrameTiming>[
      FrameTiming(
        vsyncStart: 0,
        buildStart: 0,
        buildFinish: 2000,
        rasterStart: 2000,
        rasterFinish: 4000,
        rasterFinishWallTime: 4000,
      ),
    ]);
    final Map<String, Object?> p95 = probe.snapshot()['p95']! as Map<String, Object?>;
    expect(p95['buildMs'], 2.0);
    expect(p95['rasterMs'], 2.0);
  });
}
