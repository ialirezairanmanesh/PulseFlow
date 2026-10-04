import 'package:pulseflow_bridge/pulseflow_bridge.dart';
import 'package:test/test.dart';

void main() {
  test('buildSpeedscope emits root-first frames and per-sample weights', () {
    final Map<String, dynamic> raw = <String, dynamic>{
      'samplePeriod': 2000,
      'functions': <Map<String, Object?>>[
        {'name': 'build', 'owner': {'name': 'App'}},
        {'name': 'setState', 'owner': {'name': 'State'}},
      ],
      // Leaf-first stacks: index 0 is the top of the stack.
      'samples': <Map<String, Object?>>[
        {'stack': <int>[0, 1]},
        {'stack': <int>[1]},
      ],
    };

    final Map<String, Object?> sc =
        buildSpeedscope(raw, name: 'test profile', durationMs: 4000);

    final List<dynamic> frames =
        (sc['shared']! as Map<Object?, Object?>)['frames']! as List<dynamic>;
    expect(frames.length, 2);

    final Map<Object?, Object?> profile =
        (sc['profiles']! as List<dynamic>).first as Map<Object?, Object?>;
    final List<dynamic> samples = profile['samples']! as List<dynamic>;
    expect(samples.length, 2);

    // Sample 0 must read root-first: State.setState then App.build.
    final List<String> names = (samples[0] as List<dynamic>)
        .map((dynamic i) =>
            ((frames[i as int] as Map<Object?, Object?>)['name']! as String))
        .toList();
    expect(names, <String>['State.setState', 'App.build']);

    final List<dynamic> weights = profile['weights']! as List<dynamic>;
    expect(weights[0], 2.0);
    expect(profile['unit'], 'milliseconds');
    expect(profile['endValue'], 4000);
  });

  test('buildSpeedscope tolerates empty samples', () {
    final Map<String, Object?> sc = buildSpeedscope(
      <String, dynamic>{'functions': <Object?>[], 'samples': <Object?>[]},
      name: 'empty',
    );
    final Map<Object?, Object?> profile =
        (sc['profiles']! as List<dynamic>).first as Map<Object?, Object?>;
    expect(profile['samples'], isEmpty);
  });
}
