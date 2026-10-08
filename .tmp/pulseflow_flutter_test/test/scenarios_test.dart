import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  test('builtin scenarios have unique, non-empty metadata', () {
    final List<String> ids =
        builtinScenarios.map((ScenarioInfo s) => s.id).toList();
    expect(ids, isNotEmpty);
    expect(ids.toSet().length, ids.length);
    for (final ScenarioInfo scenario in builtinScenarios) {
      expect(scenario.id, isNotEmpty);
      expect(scenario.label, isNotEmpty);
      expect(scenario.toJson()['id'], scenario.id);
    }
  });
}
