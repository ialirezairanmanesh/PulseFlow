import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    StallProbe.instance.stop();
    StallProbe.instance.reset();
  });

  test('reports recorded stalls', () {
    final StallProbe probe = StallProbe.instance;
    probe.reset();
    probe.debugRecordStall(durationMs: 400, route: '/home');
    probe.debugRecordStall(durationMs: 260, route: '/cart');

    final Map<String, Object?> report = probe.report();
    expect(report['available'], isTrue);
    expect(report['total'], 2);
    expect(report['maxDurationMs'], 400);
    final List<Object?> stalls = report['stalls']! as List<Object?>;
    expect(stalls, hasLength(2));
    expect((stalls.first! as Map<Object?, Object?>)['route'], '/home');
  });
}
