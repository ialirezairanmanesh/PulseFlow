import 'builtin_scenarios.dart';

/// Runs a custom lab scenario. Return when the workload finishes.
///
/// Call [shouldStop] between steps so `ext.pulseflow.stopScenario` can abort.
typedef PulseFlowScenarioRunner = Future<void> Function(
  Map<String, String> params, {
  required bool Function() shouldStop,
});

class _RegisteredScenario {
  const _RegisteredScenario(this.info, this.runner);

  final ScenarioInfo info;
  final PulseFlowScenarioRunner runner;
}

/// App-registered scenarios merged into `listScenarios` / `runScenario`.
class ScenarioRegistry {
  ScenarioRegistry._();

  static final ScenarioRegistry instance = ScenarioRegistry._();

  final Map<String, _RegisteredScenario> _custom = <String, _RegisteredScenario>{};

  /// Registers (or replaces) a custom scenario under [info.id].
  ///
  /// Built-in ids (`scrollStorm`, …) cannot be overridden — use a unique id.
  void register(ScenarioInfo info, PulseFlowScenarioRunner runner) {
    if (builtinScenarios.any((ScenarioInfo s) => s.id == info.id)) {
      throw ArgumentError.value(
        info.id,
        'info.id',
        'Cannot override a built-in PulseFlow scenario',
      );
    }
    _custom[info.id] = _RegisteredScenario(info, runner);
  }

  /// Removes a previously registered custom scenario.
  void unregister(String id) => _custom.remove(id);

  /// Clears all custom scenarios (tests).
  void clear() => _custom.clear();

  bool contains(String id) => _custom.containsKey(id);

  List<ScenarioInfo> get customInfos =>
      _custom.values.map((_RegisteredScenario r) => r.info).toList(growable: false);

  /// Built-ins first, then custom — what `listScenarios` returns.
  List<ScenarioInfo> listAll() => <ScenarioInfo>[
        ...builtinScenarios,
        ...customInfos,
      ];

  Future<void> run(
    String id,
    Map<String, String> params, {
    required bool Function() shouldStop,
  }) async {
    final _RegisteredScenario? entry = _custom[id];
    if (entry == null) {
      throw StateError('Unknown custom scenario: $id');
    }
    await entry.runner(params, shouldStop: shouldStop);
  }
}

/// Registers a custom PulseFlow lab scenario.
///
/// ```dart
/// registerPulseFlowScenario(
///   const ScenarioInfo(
///     id: 'openInvoice',
///     label: 'Open invoice',
///     description: 'Navigate to invoice detail and scroll',
///   ),
///   (params, {required shouldStop}) async {
///     // drive your app…
///   },
/// );
/// ```
void registerPulseFlowScenario(
  ScenarioInfo info,
  PulseFlowScenarioRunner runner,
) {
  ScenarioRegistry.instance.register(info, runner);
}
