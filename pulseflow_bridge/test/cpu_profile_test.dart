import 'package:pulseflow_bridge/pulseflow_bridge.dart';
import 'package:test/test.dart';

void main() {
  test('transformCpuSamples ranks self samples and builds a flame tree', () {
    final Map<String, dynamic> raw = <String, dynamic>{
      'samplePeriod': 1000,
      'sampleCount': 3,
      'functions': <Map<String, dynamic>>[
        {'name': 'build', 'owner': {'name': 'AppState'}, 'resolvedUrl': 'package:app/main.dart'},
        {'name': 'paint', 'owner': {'name': 'RenderBox'}},
      ],
      // Leaf-first stacks: index 0 is the top of the stack.
      'samples': <Map<String, dynamic>>[
        {'stack': <int>[0, 1]},
        {'stack': <int>[0, 1]},
        {'stack': <int>[1]},
      ],
    };

    final CpuProfileSummary profile = transformCpuSamples(raw, 3000);
    expect(profile.sampleCount, 3);
    expect(profile.topFunctions.first.qualifiedName, 'AppState.build');
    expect(profile.topFunctions.first.selfPercent, closeTo(66.7, 0.1));
    expect(profile.flameRoot.name, 'root');
    expect(profile.flameRoot.children, isNotEmpty);
  });

  test('mockCpuProfile returns a populated summary', () {
    final CpuProfileSummary profile = mockCpuProfile(5000);
    expect(profile.topFunctions, isNotEmpty);
    expect(profile.sampleCount, greaterThan(0));
  });

  test('isFrameworkOrVmFunction distinguishes framework frames', () {
    expect(isFrameworkOrVmFunction('package:flutter/src/widgets/framework.dart'), isTrue);
    expect(isFrameworkOrVmFunction('dart:math.sin'), isTrue);
    expect(isFrameworkOrVmFunction('AppState.build'), isFalse);
  });
}
