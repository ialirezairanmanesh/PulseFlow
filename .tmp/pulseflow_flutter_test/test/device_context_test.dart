import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    DeviceContext.instance.appPackage = null;
    DeviceContext.instance.enricher = null;
  });

  test('snapshot includes platform, build mode, and display', () async {
    DeviceContext.instance.appPackage = 'demo_app';
    final Map<String, Object?> snap = await DeviceContext.instance.snapshot();
    expect(snap['ok'], isTrue);
    expect(snap['appPackage'], 'demo_app');
    expect(snap['buildMode'], isNotEmpty);
    expect(snap['platform'], isNotEmpty);
    expect(snap['display'], isA<Map<Object?, Object?>>());
    final Map<Object?, Object?> display =
        snap['display']! as Map<Object?, Object?>;
    expect(display['refreshRate'], isA<num>());
    expect(display['budgetMs'], isA<num>());
  });

  test('merges enricher extras', () async {
    DeviceContext.instance.enricher = () async => <String, Object?>{
          'batteryPercent': 88,
          'appVersion': '1.2.3',
        };
    final Map<String, Object?> snap = await DeviceContext.instance.snapshot();
    final Map<Object?, Object?> extras =
        snap['extras']! as Map<Object?, Object?>;
    expect(extras['batteryPercent'], 88);
    expect(extras['appVersion'], '1.2.3');
  });
}
