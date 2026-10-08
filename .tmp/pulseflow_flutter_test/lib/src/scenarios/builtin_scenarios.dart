/// Metadata for a built-in PulseFlow lab scenario.
class ScenarioInfo {
  const ScenarioInfo({
    required this.id,
    required this.label,
    required this.description,
  });

  final String id;
  final String label;
  final String description;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'label': label,
        'description': description,
      };
}

/// The scenarios shipped with the package.
const List<ScenarioInfo> builtinScenarios = <ScenarioInfo>[
  ScenarioInfo(
    id: 'scrollStorm',
    label: 'Scroll storm',
    description: 'Rapid scroll jumps on primary scrollables',
  ),
  ScenarioInfo(
    id: 'routeThrash',
    label: 'Route thrash',
    description: 'Push/pop lightweight routes repeatedly',
  ),
  ScenarioInfo(
    id: 'listFlood',
    label: 'List flood',
    description: 'Burst-append invoice items into stress state',
  ),
  ScenarioInfo(
    id: 'animationFlood',
    label: 'Animation flood',
    description: 'Spawn repeating animation controllers',
  ),
  ScenarioInfo(
    id: 'retainMemory',
    label: 'Retain memory',
    description: 'Allocate and retain byte buffers',
  ),
  ScenarioInfo(
    id: 'networkBurst',
    label: 'Network burst',
    description:
        'Fire parallel HTTP GETs (url/count params) or an app onNetworkBurst hook',
  ),
];
