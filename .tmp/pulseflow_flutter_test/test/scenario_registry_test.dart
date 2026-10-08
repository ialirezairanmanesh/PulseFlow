import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  tearDown(() {
    ScenarioRegistry.instance.clear();
  });

  test('lists custom scenarios after built-ins', () {
    registerPulseFlowScenario(
      const ScenarioInfo(
        id: 'openInvoice',
        label: 'Open invoice',
        description: 'Navigate to invoice detail',
      ),
      (Map<String, String> params, {required bool Function() shouldStop}) async {},
    );

    final List<ScenarioInfo> all = ScenarioRegistry.instance.listAll();
    expect(all.map((ScenarioInfo s) => s.id), contains('scrollStorm'));
    expect(all.map((ScenarioInfo s) => s.id), contains('openInvoice'));
    expect(
      all.indexWhere((ScenarioInfo s) => s.id == 'openInvoice'),
      greaterThan(all.indexWhere((ScenarioInfo s) => s.id == 'scrollStorm')),
    );
  });

  test('rejects overriding built-in ids', () {
    expect(
      () => registerPulseFlowScenario(
        const ScenarioInfo(
          id: 'scrollStorm',
          label: 'Nope',
          description: 'Cannot override',
        ),
        (Map<String, String> params, {required bool Function() shouldStop}) async {},
      ),
      throwsArgumentError,
    );
  });

  test('runs a custom scenario via ScenarioRunner', () async {
    var ran = false;
    registerPulseFlowScenario(
      const ScenarioInfo(
        id: 'customPing',
        label: 'Custom ping',
        description: 'Marks a flag',
      ),
      (Map<String, String> params, {required bool Function() shouldStop}) async {
        ran = true;
      },
    );

    final Map<String, Object?> result =
        await ScenarioRunner.instance.run('customPing', <String, String>{});
    expect(result['ok'], isTrue);
    expect(result['custom'], isTrue);
    expect(ran, isTrue);
  });
}
