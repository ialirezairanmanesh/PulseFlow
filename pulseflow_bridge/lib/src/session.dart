import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:vm_service/vm_service.dart' as vm;
import 'package:vm_service/vm_service_io.dart';

import 'cpu_profile.dart';
import 'discover.dart';
import 'speedscope.dart';
import 'wire.dart';

Map<String, bool> defaultCaps() => <String, bool>{
      'cpuSamples': false,
      'clearCpuSamples': false,
      'allocationProfile': false,
      'retainingPath': false,
      'instances': false,
      'perfettoTimeline': false,
      'perfettoCpuSamples': false,
      'vmTimelineMicros': false,
      'profilerFlag': false,
      'httpProfile': false,
      'socketProfile': false,
      'pulseExtension': false,
      'scenarios': false,
      'widgetProbe': false,
      'deviceContext': false,
      'stalls': false,
    };

Map<String, bool> _mockCaps() => <String, bool>{
      'cpuSamples': true,
      'clearCpuSamples': true,
      'allocationProfile': true,
      'retainingPath': true,
      'instances': true,
      'perfettoTimeline': true,
      'perfettoCpuSamples': false,
      'vmTimelineMicros': true,
      'profilerFlag': true,
      'httpProfile': true,
      'socketProfile': true,
      'pulseExtension': true,
      'scenarios': true,
      'widgetProbe': true,
      'deviceContext': true,
      'stalls': true,
    };

const List<Map<String, Object?>> mockScenarios = <Map<String, Object?>>[
  {'id': 'scrollStorm', 'label': 'Scroll storm', 'description': 'Rapid scroll jumps on primary scrollables'},
  {'id': 'routeThrash', 'label': 'Route thrash', 'description': 'Push/pop lightweight routes repeatedly'},
  {'id': 'listFlood', 'label': 'List flood', 'description': 'Burst-append invoice items into stress state'},
  {'id': 'animationFlood', 'label': 'Animation flood', 'description': 'Spawn repeating animation controllers'},
  {'id': 'retainMemory', 'label': 'Retain memory', 'description': 'Allocate and retain byte buffers'},
  {'id': 'networkBurst', 'label': 'Network burst', 'description': 'Stubbed unless the app registers a network hook'},
];

/// Flutter DevTools-style debug toggles (ext.flutter.*).
const List<Map<String, String>> _debugOptionDefs = <Map<String, String>>[
  {
    'id': 'performanceOverlay',
    'method': 'ext.flutter.showPerformanceOverlay',
    'kind': 'bool',
  },
  {
    'id': 'debugPaint',
    'method': 'ext.flutter.debugPaint',
    'kind': 'bool',
  },
  {
    'id': 'debugPaintBaselines',
    'method': 'ext.flutter.debugPaintBaselinesEnabled',
    'kind': 'bool',
  },
  {
    'id': 'repaintRainbow',
    'method': 'ext.flutter.repaintRainbow',
    'kind': 'bool',
  },
  {
    'id': 'invertOversizedImages',
    'method': 'ext.flutter.invertOversizedImages',
    'kind': 'bool',
  },
  {
    'id': 'debugBanner',
    'method': 'ext.flutter.debugAllowBanner',
    'kind': 'bool',
  },
  {
    'id': 'slowAnimations',
    'method': 'ext.flutter.timeDilation',
    'kind': 'timeDilation',
  },
];

const double _slowAnimationDilation = 5.0;

const List<Map<String, Object?>> _mockWidgetDefs = <Map<String, Object?>>[
  {'name': 'InvoiceCard', 'route': '/invoices', 'keyLabel': 'ValueKey(row)', 'base': 36},
  {'name': 'InvoiceListTile', 'route': '/invoices', 'base': 28},
  {'name': 'AnimatedBuilder', 'route': '/dashboard', 'base': 22},
  {'name': 'StreamBuilder', 'route': '/dashboard', 'base': 18},
  {'name': 'ChartPainter', 'route': '/reports', 'base': 14},
  {'name': 'Text', 'route': '/invoices', 'isFramework': true, 'base': 40},
  {'name': 'Padding', 'route': '/invoices', 'isFramework': true, 'base': 30},
  {'name': 'ListView', 'route': '/invoices', 'base': 12},
];

/// One dashboard client's bridge session. Preserves the exact wire protocol
/// spoken by the original Node bridge.
class BridgeSession {
  BridgeSession(this._send);

  final void Function(Map<String, Object?>) _send;

  vm.VmService? _vm;
  String _mode = 'idle';
  String? _isolateId;
  final List<StreamSubscription<dynamic>> _subs = <StreamSubscription<dynamic>>[];
  Timer? _pollTimer;
  Timer? _mockTimer;
  Timer? _hotTimer;
  Timer? _cpuTimer;
  Timer? _scenarioTimer;
  final Random _rng = Random();

  double lastFrameMs = 0;
  double lastBuildMs = 0;
  double lastRasterMs = 0;
  double lastVsyncMs = 0;
  final List<int> _jankWindow = <int>[];
  List<String> _extensionMethods = <String>[];
  bool? _httpProfileSupported;
  bool? _widgetProbeAvailable;
  bool _hotWidgetsFrozen = false;
  int _recordQuietUntil = 0;
  Map<String, Object?>? _lastHotPayload;
  final Map<String, int> _mockSessionRebuilds = <String, int>{};
  Map<String, bool> _caps = defaultCaps();
  bool _cpuRecording = false;
  int? _cpuRecordStartedAt;
  int? _cpuRecordOriginMicros;
  CpuProfileSummary? _cpuProfileCache;
  Map<String, dynamic>? _lastCpuRaw;
  final List<Map<String, Object?>> _memorySnapshots = <Map<String, Object?>>[];
  final Set<String> _seenHttpIds = <String>{};
  String? _scenarioRunning;
  final List<Map<String, Object?>> _timelineMarkers = <Map<String, Object?>>[];
  final Map<String, bool> _mockDebugOptions = <String, bool>{
    for (final Map<String, String> d in _debugOptionDefs) d['id']!: false,
  };

  bool _closed = false;
  double _refreshRate = 60;
  double _budgetMs = defaultFrameBudgetMs;

  void close() {
    _closed = true;
    _disconnectVm();
  }

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------

  Future<void> handle(Map<String, dynamic> msg) async {
    try {
      switch (msg['type']) {
        case 'connect':
          await _connectVm('${msg['url']}');
          break;
        case 'disconnect':
          _disconnectVm();
          _send(<String, Object?>{'type': 'status', 'status': 'idle', 'message': 'Disconnected'});
          break;
        case 'mock':
          _startMock();
          break;
        case 'discover':
          await _discover();
          break;
        case 'refreshExtensions':
          await _refreshFlow();
          break;
        case 'stress':
          await _runStress('${msg['action']}', _asMap(msg['params']));
          break;
        case 'hotWidgetsControl':
          await _runHotWidgetsControl('${msg['action']}');
          break;
        case 'cpuRecord':
          await _handleCpuRecord('${msg['action']}', (msg['durationMs'] as num?)?.toInt() ?? 5000);
          break;
        case 'cpuExport':
          await _handleCpuExport((msg['durationMs'] as num?)?.toInt() ?? 0);
          break;
        case 'scenario':
          await _handleScenario('${msg['action']}', msg['id'] as String?, _asMap(msg['params']));
          break;
        case 'memorySnapshot':
          await _handleMemorySnapshot(
            '${msg['action']}',
            msg['snapshotId'] as String?,
            msg['classId'] as String?,
            msg['objectId'] as String?,
          );
          break;
        case 'timelineExport':
          await _handleTimelineExport((msg['durationMs'] as num?)?.toInt() ?? 5000);
          break;
        case 'networkControl':
          await _handleNetworkControl('${msg['action']}');
          break;
        case 'leakControl':
          await _handleLeakControl(
            '${msg['action']}',
            (msg['threshold'] as num?)?.toInt(),
            (msg['limit'] as num?)?.toInt(),
          );
          break;
        case 'debugOptions':
          await _handleDebugOptions(
            '${msg['action']}',
            msg['id'] as String?,
            msg['enabled'] is bool ? msg['enabled'] as bool : null,
          );
          break;
        default:
          _send(<String, Object?>{'type': 'error', 'message': 'Unknown bridge command'});
      }
    } catch (error) {
      _send(<String, Object?>{'type': 'error', 'message': '$error'});
    }
  }

  Map<String, dynamic>? _asMap(Object? value) =>
      value is Map ? value.cast<String, dynamic>() : null;

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  static bool isValidVmUrl(String url) {
    try {
      final Uri uri = Uri.parse(url);
      return uri.scheme == 'ws' || uri.scheme == 'wss';
    } catch (_) {
      return false;
    }
  }

  Future<void> _connectVm(String url) async {
    if (!isValidVmUrl(url)) {
      _send(<String, Object?>{
        'type': 'status',
        'status': 'error',
        'message': 'Enter a valid ws:// or wss:// VM Service URL (e.g. ws://127.0.0.1:8181/ws)',
      });
      return;
    }
    _disconnectVm();
    _send(<String, Object?>{
      'type': 'status',
      'status': 'connecting',
      'mode': 'live',
      'message': 'Connecting to $url',
    });
    try {
      final vm.VmService service = await vmServiceConnectUri(url);
      if (_closed) {
        service.dispose();
        return;
      }
      _vm = service;
      _wireEvents(service);
      final String isolateName = await _resolveIsolate();
      await _listenStreams();
      await _refreshExtensions();
      await _startWidgetProbe();
      await _probeCapabilities();
      _mode = 'live';
      _seenHttpIds.clear();
      _memorySnapshots.clear();
      _timelineMarkers.clear();
      _send(<String, Object?>{
        'type': 'status',
        'status': 'connected',
        'mode': 'live',
        'message': 'Connected to VM Service',
        'isolateName': isolateName,
      });
      await _sendFrameStats();
      unawaited(_handleDebugOptions('get', null, null));
      if (_caps['scenarios'] == true) {
        unawaited(_handleScenario('list', null, null));
      }
      _pollTimer = Timer.periodic(const Duration(milliseconds: 500), (_) => unawaited(_pollLiveMetrics()));
      _hotTimer = Timer.periodic(const Duration(milliseconds: 1000), (_) {
        unawaited(_pollHotWidgets());
        unawaited(_pollRebuildCauses());
        unawaited(_pollErrors());
        unawaited(_pollImages());
        unawaited(_pollStalls());
      });
      unawaited(_pollHotWidgets());
      unawaited(_pollRebuildCauses());
      unawaited(_pollErrors());
      unawaited(_pollImages());
      unawaited(_pollDeviceContext());
      unawaited(_pollStalls());
    } catch (error) {
      _disconnectVm();
      _send(<String, Object?>{'type': 'status', 'status': 'error', 'message': '$error'});
    }
  }

  void _disconnectVm() {
    _pollTimer?.cancel();
    _mockTimer?.cancel();
    _hotTimer?.cancel();
    _cpuTimer?.cancel();
    _scenarioTimer?.cancel();
    _pollTimer = null;
    _mockTimer = null;
    _hotTimer = null;
    _cpuTimer = null;
    _scenarioTimer = null;
    for (final StreamSubscription<dynamic> sub in _subs) {
      sub.cancel();
    }
    _subs.clear();
    _vm?.dispose();
    _vm = null;
    _mode = 'idle';
    _isolateId = null;
    _extensionMethods = <String>[];
    _httpProfileSupported = null;
    _widgetProbeAvailable = null;
    _hotWidgetsFrozen = false;
    _recordQuietUntil = 0;
    _caps = defaultCaps();
    _cpuProfileCache = null;
    _lastCpuRaw = null;
    _buildMode = null;
    _probeAvailability = null;
    _cpuRecordOriginMicros = null;
    _cpuRecordStartedAt = null;
    _cpuRecording = false;
    _memorySnapshots.clear();
    _seenHttpIds.clear();
    _timelineMarkers.clear();
    _lastHotPayload = null;
    _mockSessionRebuilds.clear();
    lastBuildMs = 0;
    lastRasterMs = 0;
    lastVsyncMs = 0;
    _scenarioRunning = null;
  }

  void _wireEvents(vm.VmService service) {
    void track(Stream<vm.Event> stream, void Function(vm.Event) onEvent) {
      _subs.add(stream.listen(onEvent, onError: (Object _) {}));
    }

    track(service.onExtensionEvent, _handleExtensionEvent);
    track(service.onGCEvent, _handleGcEvent);
    track(service.onTimelineEvent, _handleTimelineEvent);
    track(service.onLoggingEvent, _handleLogEvent);
    unawaited(service.onDone.then((_) {
      if (_vm == service) {
        _pollTimer?.cancel();
        _hotTimer?.cancel();
        _vm = null;
        _mode = 'idle';
        _send(<String, Object?>{
          'type': 'status',
          'status': 'disconnected',
          'message': 'VM Service closed the connection',
        });
      }
    }));
  }

  void _handleGcEvent(vm.Event event) {
    final int t = DateTime.now().millisecondsSinceEpoch;
    final String reason = event.gcType ?? 'gc';
    _pushMarker('gc', reason);
    _send(<String, Object?>{
      'type': 'gc',
      'event': {'id': _uuid(), 't': t, 'reason': reason, 'isolate': _isolateId},
    });
  }

  void _handleExtensionEvent(vm.Event event) {
    if (event.extensionKind != 'Flutter.Frame') return;
    final Map<String, dynamic> data =
        event.extensionData?.data ?? <String, dynamic>{};
    final double buildMs = usToMs((data['build'] as num?) ?? 0);
    final double rasterMs = usToMs((data['raster'] as num?) ?? 0);
    final double vsyncMs = usToMs((data['vsyncOverhead'] as num?) ?? 0);
    final double elapsedMs = usToMs((data['elapsed'] as num?) ?? 0);
    final double frameMs = elapsedMs > 0
        ? elapsedMs
        : (buildMs + rasterMs + vsyncMs * 0.25 > buildMs + rasterMs
            ? buildMs + rasterMs + vsyncMs * 0.25
            : buildMs + rasterMs);
    lastBuildMs = buildMs;
    lastRasterMs = rasterMs;
    lastVsyncMs = vsyncMs;
    lastFrameMs = frameMs;
    _jankWindow.add(frameMs > _budgetMs ? 1 : 0);
    if (_jankWindow.length > 30) _jankWindow.removeAt(0);
    if (frameMs > _budgetMs) _pushMarker('jank', 'Jank frame ${frameMs.toStringAsFixed(1)} ms');
  }

   void _handleTimelineEvent(vm.Event event) {
    for (final vm.TimelineEvent te in event.timelineEvents ?? const <vm.TimelineEvent>[]) {
      final Map<String, dynamic>? json = te.json;
      final String name = '${json?['name'] ?? ''}';
      if (RegExp('shader|compile', caseSensitive: false).hasMatch(name)) {
        _pushMarker('shader', name.isEmpty ? 'Shader compile' : name);
      }
      final int? dur = (json?['dur'] as num?)?.toInt();
      if (dur == null) continue;
      final double ms = dur / 1000;
      if (ms <= 0 || ms >= 500) continue;
      if (RegExp('^BUILD\$', caseSensitive: false).hasMatch(name)) {
        lastBuildMs = ms;
      } else if (RegExp('RASTER|GPU', caseSensitive: false).hasMatch(name)) {
        lastRasterMs = ms;
      } else if (RegExp('Frame', caseSensitive: false).hasMatch(name)) {
        lastFrameMs = ms;
        _jankWindow.add(ms > _budgetMs ? 1 : 0);
        if (_jankWindow.length > 30) _jankWindow.removeAt(0);
        if (ms > _budgetMs) _pushMarker('jank', 'Timeline frame ${ms.toStringAsFixed(1)} ms');
      }
    }
  }

  /// package:logging severity levels (see package:logging `Level`).
  static String _levelName(int level) {
    if (level >= 1200) return 'severe';
    if (level >= 1000) return 'error';
    if (level >= 900) return 'warning';
    if (level >= 800) return 'info';
    return 'debug';
  }

  void _handleLogEvent(vm.Event event) {
    final vm.LogRecord? record = event.logRecord;
    if (record == null) return;
    // Cap in-flight log buffer so the dashboard stays responsive.
    final int t = event.timestamp != null && event.timestamp! > 0
        ? event.timestamp!
        : (record.time ?? DateTime.now().millisecondsSinceEpoch);
    final String message = record.message?.valueAsString ?? '';
    if (message.isEmpty) return;
    final String level = _levelName(record.level ?? 0);
    _send(<String, Object?>{
      'type': 'log',
      'entry': <String, Object?>{
        't': t,
        'level': level,
        'severity': record.level ?? 0,
        'message': message,
        if (record.loggerName?.valueAsString != null) 'loggerName': record.loggerName!.valueAsString,
        if (record.sequenceNumber != null) 'seq': record.sequenceNumber,
      },
    });
  }

  Future<String> _resolveIsolate() async {
    final vm.VM info = await _vm!.getVM();
    final List<vm.IsolateRef> isolates = info.isolates ?? <vm.IsolateRef>[];
    vm.IsolateRef? main;
    for (final vm.IsolateRef iso in isolates) {
      if (iso.isSystemIsolate == true) continue;
      if (RegExp('main', caseSensitive: false).hasMatch(iso.name ?? '')) {
        main = iso;
        break;
      }
    }
    main ??= isolates.where((vm.IsolateRef i) => i.isSystemIsolate != true).firstOrNull ?? isolates.firstOrNull;
    if (main == null) throw StateError('No Dart isolate found on this VM Service');
    _isolateId = main.id;
    return main.name ?? main.id ?? 'isolate';
  }

  Future<void> _listenStreams() async {
    for (final String streamId in <String>['Extension', 'GC', 'Timeline', 'Logging']) {
      try {
        await _vm!.streamListen(streamId);
      } catch (_) {}
    }
  }

  Future<void> _refreshFlow() async {
    if (_mode == 'mock') {
      _sendMockExtension();
      _send(<String, Object?>{
        'type': 'scenarioStatus',
        'scenarios': mockScenarios,
        'running': _scenarioRunning,
      });
      _emitMockDebugOptions();
      return;
    }
    if (_mode == 'live') {
      await _refreshExtensions();
      await _probeCapabilities();
      if (_caps['scenarios'] == true) unawaited(_handleScenario('list', null, null));
      unawaited(_handleDebugOptions('get', null, null));
      return;
    }
    _send(<String, Object?>{
      'type': 'extension',
      'info': {'available': false, 'methods': <String>[], 'message': 'Connect first to detect PulseFlow extensions'},
    });
  }

  Future<void> _discover() async {
    _send(<String, Object?>{
      'type': 'status',
      'status': _mode == 'idle' ? 'idle' : 'connected',
      if (_mode != 'idle') 'mode': _mode,
      'message': 'Scanning for local Flutter / Dart VM Services…',
    });
    try {
      final List<DiscoveredApp> apps = await discoverRunningApps();
      _send(<String, Object?>{'type': 'discover', 'apps': apps.map((DiscoveredApp a) => a.toJson()).toList()});
      _send(<String, Object?>{
        'type': 'status',
        'status': _mode == 'idle' ? 'idle' : 'connected',
        if (_mode != 'idle') 'mode': _mode,
        'message': apps.isEmpty
            ? 'No local Flutter apps found — run an app with flutter run, or paste the VM Service URL'
            : 'Found ${apps.length} local Dart/Flutter service${apps.length == 1 ? '' : 's'}',
      });
    } catch (error) {
      _send(<String, Object?>{'type': 'error', 'message': '$error'});
    }
  }

  // ---------------------------------------------------------------------------
  // Extensions + capabilities
  // ---------------------------------------------------------------------------

  Future<void> _refreshExtensions() async {
    final String? isolateId = _isolateId;
    if (isolateId == null) return;
    try {
      final vm.Isolate isolate = await _vm!.getIsolate(isolateId);
      final List<String> methods = isolate.extensionRPCs ?? <String>[];
      _extensionMethods = methods;
      final List<String> pulse =
          methods.where((String m) => m.startsWith('ext.pulseflow.')).toList();
      final bool hasHotWidgets = methods.contains('ext.pulseflow.getHotWidgets');
      _widgetProbeAvailable = hasHotWidgets;
      _send(<String, Object?>{
        'type': 'extension',
        'info': {
          'available': pulse.isNotEmpty,
          'methods': pulse.isNotEmpty
              ? pulse
              : methods.where((String m) => m.contains('flutter')).take(8).toList(),
          'message': pulse.isNotEmpty
              ? (hasHotWidgets
                  ? 'PulseFlow extension detected — widget probe ready'
                  : 'PulseFlow stress extension detected (update stub for hot widgets)')
              : 'PulseFlow extension not registered — paste examples/pulseflow_extension.dart into your Flutter app',
        },
      });
      if (!hasHotWidgets) {
        _send(<String, Object?>{
          'type': 'hotWidgets',
          'available': false,
          'windowMs': 0,
          'totalRebuildsWindow': 0,
          'totalRebuildsSession': 0,
          'widgets': <Object?>[],
          'screens': <Object?>[],
          'message': 'Hot widgets unavailable — add pulseflow_extension.dart to the app, hot-restart, and Connect again',
        });
      }
    } catch (error) {
      _widgetProbeAvailable = false;
      _send(<String, Object?>{
        'type': 'extension',
        'info': {'available': false, 'methods': <String>[], 'message': '$error'},
      });
    }
  }

  Future<void> _startWidgetProbe() async {
    if (_isolateId == null || !_extensionMethods.contains('ext.pulseflow.startWidgetProbe')) {
      return;
    }
    try {
      await _callExtension('ext.pulseflow.startWidgetProbe');
    } catch (_) {}
  }

  Future<void> _probeCapabilities() async {
    final String? isolateId = _isolateId;
    if (isolateId == null) {
      _caps = defaultCaps();
      _send(<String, Object?>{'type': 'capabilities', 'caps': _caps, 'message': 'No isolate'});
      return;
    }

    // Enable sampling before CPU probes. getFlag is not a real VM RPC (only
    // getFlagList / setFlag exist). Probe getCpuSamples alone first — parallel
    // ADB probes can time out and falsely mark CPU unavailable on profile builds.
    await _ensureProfiler();

    final String? cpuProbeError = await _probeCpuSamples(isolateId);
    final bool cpuSamples = cpuProbeError == null;

    Future<bool> probe(String method, Map<String, dynamic> args) async {
      try {
        await _vm!
            .callServiceExtension(method, isolateId: isolateId, args: args)
            .timeout(const Duration(milliseconds: 2500));
        return true;
      } catch (error) {
        final String message = '$error';
        if (RegExp(r'MethodNotFound|unknown method|method not found', caseSensitive: false)
            .hasMatch(message)) {
          return false;
        }
        if (RegExp('timeout', caseSensitive: false).hasMatch(message)) {
          return false;
        }
        // Other errors (bad args, profiler previously disabled) still mean
        // the method exists on this VM.
        return true;
      }
    }

    final bool profilerFlag = await _profilerFlagAvailable();
    final List<bool> results = await Future.wait(<Future<bool>>[
      probe('clearCpuSamples', <String, dynamic>{}),
      probe('getAllocationProfile', <String, dynamic>{}),
      probe('getRetainingPath', <String, dynamic>{'targetId': 'objects/0', 'limit': 1}),
      probe('getInstances', <String, dynamic>{'objectId': 'classes/0', 'limit': 1}),
      _supportsPerfetto(),
      probe('getPerfettoCpuSamples', <String, dynamic>{'timeOriginMicros': 0, 'timeExtentMicros': 1}),
      probe('getVMTimelineMicros', <String, dynamic>{}),
      probe('ext.dart.io.getSocketProfile', <String, dynamic>{}),
    ]);

    final Map<String, bool> caps = defaultCaps();
    caps['cpuSamples'] = cpuSamples;
    caps['clearCpuSamples'] = results[0];
    caps['allocationProfile'] = results[1];
    caps['retainingPath'] = results[2];
    caps['instances'] = results[3];
    caps['perfettoTimeline'] = results[4];
    caps['perfettoCpuSamples'] = results[5];
    caps['vmTimelineMicros'] = results[6];
    caps['profilerFlag'] = profilerFlag;
    caps['httpProfile'] = _httpProfileSupported != false;
    caps['socketProfile'] = results[7];
    caps['pulseExtension'] = _extensionMethods.any((String m) => m.startsWith('ext.pulseflow.'));
    caps['scenarios'] = _extensionMethods.contains('ext.pulseflow.listScenarios');
    caps['widgetProbe'] = _extensionMethods.contains('ext.pulseflow.getHotWidgets');
    caps['deviceContext'] = _extensionMethods.contains('ext.pulseflow.getDeviceContext');
    caps['stalls'] = _extensionMethods.contains('ext.pulseflow.getStallReport');
    _caps = caps;
    _send(<String, Object?>{
      'type': 'capabilities',
      'caps': caps,
      'message': cpuSamples
          ? 'VM/DDS capability probe complete'
          : 'VM/DDS capability probe complete — CPU unavailable: $cpuProbeError',
      if (cpuProbeError != null) 'cpuProbeError': cpuProbeError,
    });
  }

  /// Returns `null` when getCpuSamples is usable, otherwise the failure reason.
  Future<String?> _probeCpuSamples(String isolateId) async {
    Future<String?> attempt() async {
      try {
        await _vm!
            .getCpuSamples(isolateId, 0, 1)
            .timeout(const Duration(seconds: 8));
        return null;
      } catch (error) {
        final String message = '$error';
        // Profiler disabled still means the RPC exists — enable and treat as OK.
        if (RegExp('profiler', caseSensitive: false).hasMatch(message) &&
            RegExp('disabled|not enabled|not responding', caseSensitive: false)
                .hasMatch(message)) {
          await _ensureProfiler();
          try {
            await _vm!
                .getCpuSamples(isolateId, 0, 1)
                .timeout(const Duration(seconds: 8));
            return null;
          } catch (retryError) {
            final String retryMessage = '$retryError';
            if (RegExp('profiler', caseSensitive: false).hasMatch(retryMessage)) {
              // Method exists; recording path will call setFlag again.
              return null;
            }
            return retryMessage;
          }
        }
        if (RegExp(r'MethodNotFound|unknown method|method not found', caseSensitive: false)
            .hasMatch(message)) {
          return message;
        }
        if (RegExp('timeout', caseSensitive: false).hasMatch(message)) {
          return 'timeout';
        }
        // Any other RPC/parse error ⇒ method is present.
        return null;
      }
    }

    final String? first = await attempt();
    if (first == null || first != 'timeout') return first;
    await Future<void>.delayed(const Duration(milliseconds: 400));
    await _ensureProfiler();
    return attempt();
  }

  Future<bool> _profilerFlagAvailable() async {
    try {
      final vm.FlagList flags = await _vm!.getFlagList().timeout(const Duration(milliseconds: 2500));
      return flags.flags?.any((vm.Flag f) => f.name == 'profiler') == true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> _supportsPerfetto() async {
    try {
      await _vm!.getVMTimelineMicros().timeout(const Duration(milliseconds: 1200));
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _sendFrameStats() async {
    if (_isolateId == null || !_extensionMethods.contains('ext.pulseflow.getFrameStats')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension('ext.pulseflow.getFrameStats');
      if (data == null) return;
      final double? rate = (data['refreshRate'] as num?)?.toDouble();
      final double? budget = (data['budgetMs'] as num?)?.toDouble();
      if (rate != null && rate > 0) _refreshRate = rate;
      if (budget != null && budget > 0) _budgetMs = budget;
      final String? mode = data['buildMode'] as String?;
      if (mode != null) _buildMode = mode;
      final Object? probes = data['probes'];
      if (probes is Map) {
        _probeAvailability = probes.map(
          (Object? k, Object? v) => MapEntry<String, dynamic>('$k', v == true),
        );
      }
      _send(<String, Object?>{
        'type': 'buildInfo',
        'buildMode': _buildMode ?? 'unknown',
        'probes': _probeAvailability ?? <String, Object?>{},
      });
      _reportedFrames = true;
    } catch (_) {}
  }

  bool _reportedFrames = false;
  String? _buildMode;
  Map<String, dynamic>? _probeAvailability;

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  Future<void> _pollLiveMetrics() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_reportedFrames && _extensionMethods.contains('ext.pulseflow.getFrameStats')) {
      await _sendFrameStats();
    }
    final ({double heapMb, double externalMb}) mem = await _pollMemory();
    final double buildMs = lastBuildMs;
    final double rasterMs = lastRasterMs;
    final double frameMs = lastFrameMs > 0 ? lastFrameMs : (buildMs + rasterMs > 0 ? buildMs + rasterMs : 0);
    _send(<String, Object?>{
      'type': 'metrics',
      'point': {
        't': DateTime.now().millisecondsSinceEpoch,
        'cpu': framePressure(buildMs, rasterMs, frameMs, budgetMs: _budgetMs),
        'framePressure': framePressure(buildMs, rasterMs, frameMs, budgetMs: _budgetMs),
        'frameMs': round2(frameMs),
        'buildMs': round2(buildMs),
        'rasterMs': round2(rasterMs),
        'vsyncMs': round2(lastVsyncMs),
        'jank': frameMs > _budgetMs ? 1 : 0,
        'heapMb': round2(mem.heapMb),
        'externalMb': round2(mem.externalMb),
        'refreshRate': _refreshRate,
        'buildBudgetMs': _budgetMs,
      },
    });
    await _pollHttpProfile();
    await _pollAppNetworkLog();
  }

  Future<({double heapMb, double externalMb})> _pollMemory() async {
    final String? isolateId = _isolateId;
    if (isolateId == null) return (heapMb: 0.0, externalMb: 0.0);
    try {
      final vm.MemoryUsage usage = await _vm!.getMemoryUsage(isolateId);
      final int heap = usage.heapUsage ?? usage.heapCapacity ?? 0;
      final int external = usage.externalUsage ?? 0;
      return (heapMb: heap / (1024 * 1024), externalMb: external / (1024 * 1024));
    } catch (_) {
      try {
        final vm.AllocationProfile profile = await _vm!.getAllocationProfile(isolateId);
        final int heap = profile.memoryUsage?.heapUsage ?? 0;
        final int external = profile.memoryUsage?.externalUsage ?? 0;
        return (heapMb: heap / (1024 * 1024), externalMb: external / (1024 * 1024));
      } catch (_) {
        return (heapMb: 0.0, externalMb: 0.0);
      }
    }
  }

  Future<void> _pollHttpProfile() async {
    final String? isolateId = _isolateId;
    if (isolateId == null || _httpProfileSupported == false) return;
    try {
      final Map<String, dynamic>? result =
          await _raw('getHttpProfile', const <String, dynamic>{}, isolateId: isolateId);
      _httpProfileSupported = true;
      _caps['httpProfile'] = true;
      final List<dynamic> requests = (result?['requests'] as List<dynamic>?) ?? <dynamic>[];
      final List<Map<String, Object?>> batch = <Map<String, Object?>>[];
      for (final dynamic raw in requests) {
        if (raw is! Map) continue;
        final String id = '${raw['id'] ?? ''}';
        if (id.isEmpty || _seenHttpIds.contains(id)) continue;
        _seenHttpIds.add(id);
        final num start = (raw['startTime'] as num?) ?? 0;
        final num end = (raw['endTime'] as num?) ?? start;
        batch.add(<String, Object?>{
          'id': id,
          't': DateTime.now().millisecondsSinceEpoch,
          'method': '${raw['method'] ?? 'GET'}',
          'uri': '${raw['uri'] ?? '/'}',
          'latencyMs': double.parse(((end - start) / 1000).toStringAsFixed(1)),
          'requestBytes': (raw['requestBodyBytes'] as num?)?.toInt() ?? 0,
          'responseBytes': (raw['responseBodyBytes'] as num?)?.toInt() ?? 0,
          if (raw['response'] is Map && (raw['response'] as Map)['statusCode'] != null)
            'status': ((raw['response'] as Map)['statusCode'] as num).toInt(),
        });
      }
      if (_seenHttpIds.length > 2000) {
        final List<String> keep = _seenHttpIds.toList().sublist(_seenHttpIds.length - 1000);
        _seenHttpIds
          ..clear()
          ..addAll(keep);
      }
      if (batch.isNotEmpty) {
        _send(<String, Object?>{
          'type': 'network',
          'available': true,
          'requests': batch,
          'request': batch.last,
        });
      }
    } catch (_) {
      if (_httpProfileSupported == null) {
        _httpProfileSupported = false;
        _caps['httpProfile'] = false;
        _send(<String, Object?>{
          'type': 'network',
          'available': false,
          'message': 'HTTP profile not exposed by this VM/DDS — network panel will stay empty until available',
        });
      }
    }
  }

  Future<void> _pollAppNetworkLog() async {
    if (_isolateId == null || !_extensionMethods.contains('ext.pulseflow.getNetworkLog')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension('ext.pulseflow.getNetworkLog');
      final List<dynamic> requests = (data?['requests'] as List<dynamic>?) ?? <dynamic>[];
      if (requests.isEmpty) return;
      final List<Map<String, Object?>> batch = requests
          .whereType<Map>()
          .map((Map<dynamic, dynamic> m) => m.cast<String, Object?>())
          .toList();
      _send(<String, Object?>{
        'type': 'network',
        'available': true,
        'requests': batch,
        'request': batch.last,
      });
    } catch (_) {}
  }

  Future<void> _pollHotWidgets() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (_hotWidgetsFrozen) return;
    if (DateTime.now().millisecondsSinceEpoch < _recordQuietUntil) return;
    if (!_extensionMethods.contains('ext.pulseflow.getHotWidgets')) {
      if (_widgetProbeAvailable != false) {
        _widgetProbeAvailable = false;
        _send(<String, Object?>{
          'type': 'hotWidgets',
          'available': false,
          'windowMs': 0,
          'totalRebuildsWindow': 0,
          'totalRebuildsSession': 0,
          'widgets': <Object?>[],
          'screens': <Object?>[],
          'message': 'Hot widgets unavailable — add pulseflow_extension.dart to the app',
        });
      }
      return;
    }
    try {
      final Map<String, dynamic>? data =
          await _callExtension('ext.pulseflow.getHotWidgets', args: <String, dynamic>{'limit': '500'});
      if (data == null) return;
      final int windowMs = (data['windowMs'] as num?)?.toInt() ?? 10000;
      final bool duringJank = lastFrameMs > _budgetMs;
      final List<Map<String, dynamic>> rawWidgets =
          ((data['widgets'] as List<dynamic>?) ?? <dynamic>[]).whereType<Map>().map((Map m) => m.cast<String, dynamic>()).toList();
      final int totalWindow = (data['totalRebuildsWindow'] as num?)?.toInt() ??
          rawWidgets.fold<int>(0, (int a, Map<String, dynamic> w) => a + ((w['rebuildsWindow'] as num?)?.toInt() ?? 0));
      final int totalSession = (data['totalRebuildsSession'] as num?)?.toInt() ??
          rawWidgets.fold<int>(0, (int a, Map<String, dynamic> w) => a + ((w['rebuildsSession'] as num?)?.toInt() ?? 0));
      final List<Map<String, Object?>> widgets = rawWidgets
          .map((Map<String, dynamic> w) => _mapWidgetStat(w, totalWindow, windowMs, duringJank))
          .toList();
      final List<Map<String, Object?>> tree = ((data['tree'] as List<dynamic>?) ?? <dynamic>[])
          .whereType<Map>()
          .map((Map m) => _mapWidgetStat(m.cast<String, dynamic>(), totalWindow, windowMs, duringJank))
          .toList();
      final List<Map<String, Object?>> primary = tree.isNotEmpty ? tree : widgets;
      final List<Map<String, Object?>> screens =
          _mapScreens(data, primary, totalWindow, windowMs, duringJank);
      _widgetProbeAvailable = true;
      final Map<String, Object?> payload = <String, Object?>{
        'type': 'hotWidgets',
        'available': true,
        'windowMs': windowMs,
        'totalRebuildsWindow': totalWindow,
        'totalRebuildsSession': totalSession,
        'totalRebuilds': totalWindow,
        if (data['currentRoute'] != null) 'currentRoute': '${data['currentRoute']}',
        'widgets': primary,
        if (tree.isNotEmpty) 'tree': tree,
        'screens': screens,
        'frozen': (data['frozen'] == true) || _hotWidgetsFrozen,
        'duringJank': duringJank,
        if (primary.isEmpty) 'message': 'Sampling widget tree — open a screen in the app',
      };
      _lastHotPayload = payload;
      _send(payload);
    } catch (error) {
      _send(<String, Object?>{
        'type': 'hotWidgets',
        'available': false,
        'windowMs': 0,
        'totalRebuildsWindow': 0,
        'totalRebuildsSession': 0,
        'widgets': <Object?>[],
        'screens': <Object?>[],
        'message': '$error',
      });
    }
  }

  Future<void> _pollRebuildCauses() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_extensionMethods.contains('ext.pulseflow.getRebuildCauses')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.getRebuildCauses',
        args: <String, dynamic>{'limit': '20'},
      );
      if (data == null) return;
      _send(<String, Object?>{
        'type': 'rebuildCauses',
        'available': data['available'] != false,
        'windowMs': data['windowMs'] ?? 10000,
        'roots': (data['roots'] as List<dynamic>?) ?? <Object?>[],
        'attributed': (data['attributed'] as List<dynamic>?) ?? <Object?>[],
      });
    } catch (_) {}
  }

  Future<void> _pollErrors() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_extensionMethods.contains('ext.pulseflow.getErrors')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.getErrors',
        args: <String, dynamic>{'limit': '40'},
      );
      if (data == null) return;
      _send(<String, Object?>{
        'type': 'errors',
        'available': data['available'] != false,
        'total': data['total'] ?? 0,
        'errors': (data['errors'] as List<dynamic>?) ?? <Object?>[],
      });
    } catch (_) {}
  }

  Future<void> _pollImages() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_extensionMethods.contains('ext.pulseflow.getImageStats')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.getImageStats',
        args: <String, dynamic>{'limit': '30'},
      );
      if (data == null) return;
      _send(<String, Object?>{
        'type': 'images',
        'available': data['available'] != false,
        'cache': data['cache'] ?? <String, Object?>{},
        'oversized': (data['oversized'] as List<dynamic>?) ?? <Object?>[],
      });
    } catch (_) {}
  }

  Future<void> _pollDeviceContext() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_extensionMethods.contains('ext.pulseflow.getDeviceContext')) return;
    try {
      final Map<String, dynamic>? data =
          await _callExtension('ext.pulseflow.getDeviceContext');
      if (data == null) return;
      _send(<String, Object?>{
        'type': 'deviceContext',
        'available': data['ok'] != false,
        'platform': data['platform'],
        'buildMode': data['buildMode'],
        'locale': data['locale'],
        'textScale': data['textScale'],
        'appPackage': data['appPackage'],
        'display': data['display'] ?? <String, Object?>{},
        'extras': data['extras'] ?? <String, Object?>{},
      });
    } catch (_) {}
  }

  Future<void> _pollStalls() async {
    if (_mode != 'live' || _isolateId == null) return;
    if (!_extensionMethods.contains('ext.pulseflow.getStallReport')) return;
    try {
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.getStallReport',
        args: <String, dynamic>{'limit': '40'},
      );
      if (data == null) return;
      _send(<String, Object?>{
        'type': 'stalls',
        'available': data['available'] != false,
        'active': data['active'] == true,
        'thresholdMs': data['thresholdMs'] ?? 250,
        'total': data['total'] ?? 0,
        'maxDurationMs': data['maxDurationMs'] ?? 0,
        'stalls': (data['stalls'] as List<dynamic>?) ?? <Object?>[],
      });
    } catch (_) {}
  }

  Map<String, Object?> _mapWidgetStat(
    Map<String, dynamic> raw,
    int totalWindow,
    int windowMs,
    bool duringJank,
  ) {
    final String name = '${raw['name'] ?? 'Widget'}';
    final String route = '${raw['route'] ?? '(unnamed)'}';
    final String? keyLabel = raw['keyLabel'] != null ? '${raw['keyLabel']}' : null;
    final String id = '${raw['id'] ?? '$route|$name|${keyLabel ?? ''}'}';
    final int rebuildsWindow = ((raw['rebuildsWindow'] ?? raw['rebuilds']) as num?)?.toInt() ?? 0;
    final int rebuildsSession = (raw['rebuildsSession'] as num?)?.toInt() ?? rebuildsWindow;
    final double windowSec = windowMs <= 0 ? 10 : windowMs / 1000;
    return <String, Object?>{
      'id': id,
      'name': name,
      'route': route,
      if (keyLabel != null) 'keyLabel': keyLabel,
      if (raw['sourceUri'] != null) 'sourceUri': '${raw['sourceUri']}',
      if (raw['sourceLine'] != null) 'sourceLine': (raw['sourceLine'] as num).toInt(),
      if (raw['cause'] != null) 'cause': '${raw['cause']}',
      'rebuildsSession': rebuildsSession,
      'rebuildsWindow': rebuildsWindow,
      'ratePerSec': (raw['ratePerSec'] as num?)?.toDouble() ??
          double.parse((rebuildsWindow / windowSec).toStringAsFixed(2)),
      'share': (raw['share'] as num?)?.toDouble() ??
          (totalWindow > 0 ? double.parse(((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1)) : 0.0),
      'lastSeenMs': (raw['lastSeenMs'] as num?)?.toInt() ?? 0,
      'isFramework': raw['isFramework'] == true,
      'duringJank': raw['duringJank'] == true || duringJank,
      if (raw['parentId'] != null) 'parentId': '${raw['parentId']}',
      if (raw['depth'] != null) 'depth': (raw['depth'] as num).toInt(),
      if (raw['inTree'] != null) 'inTree': raw['inTree'] == true,
    };
  }

  List<Map<String, Object?>> _mapScreens(
    Map<String, dynamic> data,
    List<Map<String, Object?>> widgets,
    int totalWindow,
    int windowMs,
    bool duringJank,
  ) {
    final double windowSec = windowMs <= 0 ? 10 : windowMs / 1000;
    final List<dynamic>? rawScreens = data['screens'] as List<dynamic>?;
    if (rawScreens != null) {
      return rawScreens.whereType<Map>().map((Map m) {
        final Map<String, dynamic> s = m.cast<String, dynamic>();
        final List<Map<String, Object?>> top =
            ((s['topWidgets'] as List<dynamic>?) ?? <dynamic>[])
                .whereType<Map>()
                .map((Map w) => _mapWidgetStat(w.cast<String, dynamic>(), totalWindow, windowMs, duringJank))
                .toList();
        final int rebuildsWindow = (s['rebuildsWindow'] as num?)?.toInt() ??
            top.fold<int>(0, (int a, Map<String, Object?> w) => a + (w['rebuildsWindow'] as int));
        return <String, Object?>{
          'route': '${s['route'] ?? '(unnamed)'}',
          'rebuildsWindow': rebuildsWindow,
          'ratePerSec': (s['ratePerSec'] as num?)?.toDouble() ??
              double.parse((rebuildsWindow / windowSec).toStringAsFixed(2)),
          'share': (s['share'] as num?)?.toDouble() ??
              (totalWindow > 0 ? double.parse(((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1)) : 0.0),
          'topWidgets': top,
        };
      }).toList();
    }
    final Map<String, List<Map<String, Object?>>> byRoute = <String, List<Map<String, Object?>>>{};
    for (final Map<String, Object?> w in widgets) {
      byRoute.putIfAbsent(w['route']! as String, () => <Map<String, Object?>>[]).add(w);
    }
    final List<Map<String, Object?>> screens = byRoute.entries.map((MapEntry<String, List<Map<String, Object?>>> e) {
      final int rebuildsWindow =
          e.value.fold<int>(0, (int a, Map<String, Object?> w) => a + (w['rebuildsWindow'] as int));
      return <String, Object?>{
        'route': e.key,
        'rebuildsWindow': rebuildsWindow,
        'ratePerSec': double.parse((rebuildsWindow / windowSec).toStringAsFixed(2)),
        'share': totalWindow > 0 ? double.parse(((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1)) : 0.0,
        'topWidgets': e.value.take(5).toList(),
      };
    }).toList()
      ..sort((Map<String, Object?> a, Map<String, Object?> b) =>
          (b['rebuildsWindow'] as int).compareTo(a['rebuildsWindow'] as int));
    return screens;
  }

  // ---------------------------------------------------------------------------
  // Hot widgets controls
  // ---------------------------------------------------------------------------

  Future<void> _runHotWidgetsControl(String action) async {
    if (_mode == 'mock') {
      _mockHotWidgetsControl(action);
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect to an app (or demo mode) before Record / Freeze'});
      return;
    }
    try {
      if (action == 'reset') {
        _hotWidgetsFrozen = false;
        _recordQuietUntil = DateTime.now().millisecondsSinceEpoch + 2500;
        _sendClearedHotWidgets('Recording — counters cleared, waiting for new samples…');
        if (_extensionMethods.contains('ext.pulseflow.resetWidgetProbe')) {
          await _callExtension('ext.pulseflow.resetWidgetProbe');
        } else if (_extensionMethods.contains('ext.pulseflow.stopWidgetProbe')) {
          try {
            await _callExtension('ext.pulseflow.stopWidgetProbe');
          } catch (_) {}
          if (_extensionMethods.contains('ext.pulseflow.startWidgetProbe')) {
            await _callExtension('ext.pulseflow.startWidgetProbe');
          }
        }
        _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'live', 'message': 'Recording — session cleared'});
        return;
      }
      final bool frozen = action == 'freeze';
      _hotWidgetsFrozen = frozen;
      if (_extensionMethods.contains('ext.pulseflow.setWidgetProbeFrozen')) {
        await _callExtension('ext.pulseflow.setWidgetProbeFrozen', args: <String, dynamic>{'frozen': '$frozen'});
      }
      if (frozen) {
        _sendFrozenAck('Frozen — ranks held still');
      } else {
        await _pollHotWidgets();
      }
      _send(<String, Object?>{
        'type': 'status',
        'status': 'connected',
        'mode': 'live',
        'message': frozen ? 'Widget probe frozen' : 'Widget probe unfrozen',
      });
    } catch (error) {
      _send(<String, Object?>{'type': 'error', 'message': '$error'});
    }
  }

  void _sendFrozenAck(String message) {
    final Map<String, Object?> base = _lastHotPayload ??
        <String, Object?>{
          'type': 'hotWidgets',
          'available': true,
          'windowMs': 10000,
          'totalRebuildsWindow': 0,
          'totalRebuildsSession': 0,
          'totalRebuilds': 0,
          'widgets': <Object?>[],
          'screens': <Object?>[],
        };
    final Map<String, Object?> payload = <String, Object?>{
      ...base,
      'frozen': true,
      'message': message,
    };
    _lastHotPayload = payload;
    _send(payload);
  }

  void _sendClearedHotWidgets(String message) {
    final Map<String, Object?> payload = <String, Object?>{
      'type': 'hotWidgets',
      'available': true,
      'windowMs': 10000,
      'totalRebuildsWindow': 0,
      'totalRebuildsSession': 0,
      'totalRebuilds': 0,
      'widgets': <Object?>[],
      'screens': <Object?>[],
      'frozen': false,
      'message': message,
    };
    _lastHotPayload = payload;
    _send(payload);
  }

  // ---------------------------------------------------------------------------
  // CPU record
  // ---------------------------------------------------------------------------

  Future<void> _handleCpuRecord(String action, int durationMs) async {
    final int clamped = <int>[3000, 5000, 10000].contains(durationMs) ? durationMs : 5000;
    if (action == 'stop') {
      if (!_cpuRecording) {
        _send(<String, Object?>{
          'type': 'cpuProfile',
          'available': _cpuProfileCache != null,
          if (_cpuProfileCache != null) 'profile': _cpuProfileCache!.toJson(),
          'recording': false,
          'message': 'No CPU recording in progress',
        });
        return;
      }
      await _finishCpuRecord();
      return;
    }
    if (_cpuRecording) {
      _send(<String, Object?>{'type': 'error', 'message': 'CPU recording already in progress'});
      return;
    }
    if (_mode == 'idle') {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect or start demo mode before recording CPU'});
      return;
    }
    if (_mode == 'live' && _caps['cpuSamples'] != true) {
      _send(<String, Object?>{
        'type': 'cpuProfile',
        'available': false,
        'recording': false,
        'message': 'getCpuSamples not available on this VM — use Flutter profile mode with the CPU profiler enabled',
      });
      return;
    }
    _cpuRecording = true;
    _cpuRecordStartedAt = DateTime.now().millisecondsSinceEpoch;
    final int waitMs = _mode == 'mock' ? (clamped < 800 ? clamped : 800) : clamped;
    if (_mode == 'live' && _isolateId != null) {
      await _ensureProfiler();
      if (_caps['clearCpuSamples'] == true) {
        try {
          await _vm!.clearCpuSamples(_isolateId!);
        } catch (_) {}
      }
      if (_caps['vmTimelineMicros'] == true) {
        try {
          _cpuRecordOriginMicros = (await _vm!.getVMTimelineMicros()).timestamp;
        } catch (_) {
          _cpuRecordOriginMicros = 0;
        }
      } else {
        _cpuRecordOriginMicros = 0;
      }
    }
    _send(<String, Object?>{'type': 'cpuProfile', 'available': true, 'recording': true, 'message': 'Recording CPU for $clamped ms…'});
    _cpuTimer = Timer(Duration(milliseconds: waitMs), () => unawaited(_finishCpuRecord()));
  }

  Future<void> _ensureProfiler() async {
    try {
      final vm.FlagList flags = await _vm!.getFlagList().timeout(const Duration(milliseconds: 2500));
      final vm.Flag? profiler =
          flags.flags?.where((vm.Flag f) => f.name == 'profiler').firstOrNull;
      if (profiler?.valueAsString == 'true') return;
    } catch (_) {
      // Fall through and still try setFlag — getFlagList can lag on cold connect.
    }
    try {
      await _vm!.setFlag('profiler', 'true');
    } catch (_) {}
  }

  Future<void> _finishCpuRecord() async {
    _cpuTimer?.cancel();
    _cpuTimer = null;
    final int startedAt = _cpuRecordStartedAt ?? DateTime.now().millisecondsSinceEpoch;
    final int durationMs = DateTime.now().millisecondsSinceEpoch - startedAt < 100
        ? 100
        : DateTime.now().millisecondsSinceEpoch - startedAt;
    _cpuRecording = false;
    if (_mode == 'mock') {
      final CpuProfileSummary profile = mockCpuProfile(durationMs);
      _cpuProfileCache = profile;
      _lastCpuRaw ??= _mockCpuRawSamples();
      _send(<String, Object?>{
        'type': 'cpuProfile',
        'available': true,
        'recording': false,
        'profile': profile.toJson(),
        'message': 'Demo CPU profile ready',
      });
      return;
    }
    if (_isolateId == null || _caps['cpuSamples'] != true) {
      _send(<String, Object?>{
        'type': 'cpuProfile',
        'available': false,
        'recording': false,
        'message': 'CPU samples unavailable — run in profile mode and ensure the VM profiler is enabled',
      });
      return;
    }
    try {
      int origin = _cpuRecordOriginMicros ?? 0;
      int extent = durationMs * 1000;
      if (_caps['vmTimelineMicros'] == true) {
        final int? end = (await _vm!.getVMTimelineMicros()).timestamp;
        if (end != null) {
          if (origin == 0) origin = end - extent > 0 ? end - extent : 0;
          extent = end - origin > 1 ? end - origin : 1;
        }
      }
      final Map<String, dynamic>? result = await _raw('getCpuSamples', <String, dynamic>{
        'timeOriginMicros': origin,
        'timeExtentMicros': extent,
      }, isolateId: _isolateId);
      final CpuProfileSummary profile = transformCpuSamples(result ?? <String, dynamic>{}, durationMs);
      _cpuProfileCache = profile;
      if (result != null) _lastCpuRaw = result;
      _send(<String, Object?>{
        'type': 'cpuProfile',
        'available': true,
        'recording': false,
        'profile': profile.toJson(),
        'message': 'CPU profile: ${profile.sampleCount} samples over ${durationMs} ms',
      });
    } catch (error) {
      _send(<String, Object?>{
        'type': 'cpuProfile',
        'available': false,
        'recording': false,
        'message': '$error',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  Map<String, dynamic> _mockCpuRawSamples() => <String, dynamic>{
        'samplePeriod': 1000,
        'functions': <Map<String, Object?>>[
          {'name': 'build', 'owner': {'name': 'InvoiceListState'}},
          {'name': 'setState', 'owner': {'name': 'State'}},
          {'name': 'performLayout', 'owner': {'name': 'RenderFlex'}},
          {'name': 'jsonDecode', 'owner': {'name': 'dart:convert'}},
        ],
        'samples': <Map<String, Object?>>[
          {'stack': <int>[0, 1]},
          {'stack': <int>[0, 1]},
          {'stack': <int>[0, 2, 3]},
          {'stack': <int>[0]},
        ],
      };

  Future<void> _handleCpuExport(int durationMs) async {
    final Map<String, dynamic>? raw = _lastCpuRaw;
    if (raw == null) {
      _send(<String, Object?>{
        'type': 'cpuExport',
        'available': false,
        'format': 'speedscope',
        'message': 'Record a CPU profile first',
      });
      return;
    }
    final int effectiveDuration =
        durationMs > 0 ? durationMs : (_cpuProfileCache?.durationMs ?? 5000);
    final Map<String, Object?> payload = buildSpeedscope(
      raw,
      name: 'PulseFlow CPU ${DateTime.now().toIso8601String()}',
      durationMs: effectiveDuration,
    );
    final String encoded =
        base64Encode(utf8.encode(jsonEncode(payload)));
    _send(<String, Object?>{
      'type': 'cpuExport',
      'available': true,
      'format': 'speedscope',
      'base64': encoded,
      'fileName': 'pulseflow-${DateTime.now().millisecondsSinceEpoch}.speedscope.json',
      'message': 'Speedscope profile ready',
    });
  }

  Future<void> _handleScenario(String action, String? id, Map<String, dynamic>? params) async {
    if (_mode == 'mock') {
      _mockScenario(action, id, params);
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{
        'type': 'error',
        'message': 'Connect to a Flutter app (with PulseFlow stub) to run scenarios',
      });
      return;
    }
    if (action == 'list') {
      if (!_extensionMethods.contains('ext.pulseflow.listScenarios')) {
        _send(<String, Object?>{
          'type': 'scenarioStatus',
          'scenarios': <Object?>[],
          'running': null,
          'message': 'Scenario API missing — update examples/pulseflow_extension.dart and hot-restart',
        });
        return;
      }
      try {
        final Map<String, dynamic>? data = await _callExtension('ext.pulseflow.listScenarios');
        final List<dynamic> scenarios = (data?['scenarios'] as List<dynamic>?) ?? <dynamic>[];
        _send(<String, Object?>{
          'type': 'scenarioStatus',
          'scenarios': scenarios.isNotEmpty ? scenarios : mockScenarios,
          'running': _scenarioRunning,
          'message': 'Scenarios loaded',
        });
      } catch (error) {
        _send(<String, Object?>{'type': 'error', 'message': '$error'});
      }
      return;
    }
    if (action == 'stop') {
      try {
        await _callExtension('ext.pulseflow.stopScenario');
        final String? stopped = _scenarioRunning;
        _scenarioRunning = null;
        _send(<String, Object?>{
          'type': 'scenarioStatus',
          'running': null,
          'result': {'id': stopped ?? 'unknown', 'ok': true, 'stopped': true},
          'message': 'Scenario stopped',
        });
      } catch (error) {
        _send(<String, Object?>{'type': 'error', 'message': '$error'});
      }
      return;
    }
    if (id == null) {
      _send(<String, Object?>{'type': 'error', 'message': 'Scenario id required'});
      return;
    }
    if (!_extensionMethods.contains('ext.pulseflow.runScenario')) {
      _send(<String, Object?>{'type': 'scenarioStatus', 'running': null, 'message': 'ext.pulseflow.runScenario not registered'});
      return;
    }
    try {
      _scenarioRunning = id;
      _send(<String, Object?>{'type': 'scenarioStatus', 'running': id, 'message': 'Running scenario $id'});
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.runScenario',
        args: <String, dynamic>{
          'id': id,
          if (params != null) 'params': jsonEncode(params),
        },
        timeout: const Duration(seconds: 60),
      );
      final Map<String, dynamic> json = data ?? <String, dynamic>{};
      _scenarioRunning = null;
      _send(<String, Object?>{
        'type': 'scenarioStatus',
        'running': null,
        'result': {
          'id': id,
          'ok': json['ok'] ?? true,
          if (json['stubbed'] != null) 'stubbed': json['stubbed'],
          if (json['reason'] != null) 'reason': json['reason'],
          if (json['durationMs'] != null) 'durationMs': json['durationMs'],
          if (json['message'] != null) 'message': json['message'],
        },
        'message': json['ok'] == false ? '${json['reason'] ?? 'Scenario failed'}' : 'Scenario $id finished',
      });
    } catch (error) {
      _scenarioRunning = null;
      _send(<String, Object?>{'type': 'error', 'message': '$error'});
    }
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  Future<void> _handleMemorySnapshot(String action, String? snapshotId, String? classId, String? objectId) async {
    if (_mode == 'mock') {
      _mockMemory(action, snapshotId);
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect before capturing memory snapshots'});
      return;
    }
    if (action == 'capture') {
      if (_caps['allocationProfile'] != true) {
        _send(<String, Object?>{'type': 'memoryProfile', 'available': false, 'message': 'getAllocationProfile not available on this VM'});
        return;
      }
      try {
        final vm.AllocationProfile profile = await _vm!.getAllocationProfile(_isolateId!);
        final ({double heapMb, double externalMb}) mem = await _pollMemory();
        final List<Map<String, Object?>> classes = _mapAllocationClasses(profile);
        final Map<String, Object?> snap = <String, Object?>{
          'id': _uuid(),
          't': DateTime.now().millisecondsSinceEpoch,
          'heapMb': round2(mem.heapMb),
          'externalMb': round2(mem.externalMb),
          'classes': classes,
        };
        _memorySnapshots.add(snap);
        if (_memorySnapshots.length > 4) _memorySnapshots.removeAt(0);
        _send(<String, Object?>{'type': 'memoryProfile', 'available': true, 'snapshot': snap, 'message': 'Snapshot captured (${classes.length} classes)'});
      } catch (error) {
        _send(<String, Object?>{'type': 'memoryProfile', 'available': false, 'message': '$error'});
      }
      return;
    }
    if (action == 'diff') {
      final Map<String, Object?>? from = _memorySnapshots.length >= 2
          ? _memorySnapshots[_memorySnapshots.length - 2]
          : null;
      Map<String, Object?>? to =
          _memorySnapshots.isNotEmpty ? _memorySnapshots.last : null;
      if (snapshotId != null) {
        to = _memorySnapshots.firstWhere((Map<String, Object?> s) => s['id'] == snapshotId, orElse: () => to ?? <String, Object?>{});
      }
      if (from == null || to == null) {
        _send(<String, Object?>{'type': 'memoryProfile', 'available': true, 'message': 'Need two snapshots to diff — capture again'});
        return;
      }
      final List<Map<String, Object?>> grew = _diffSnapshots(from, to);
      _send(<String, Object?>{
        'type': 'memoryProfile',
        'available': true,
        'diff': {'fromId': from['id'], 'toId': to['id'], 'grew': grew},
        'message': '${grew.length} growing classes',
      });
      return;
    }
    if (_caps['retainingPath'] != true) {
      _send(<String, Object?>{'type': 'memoryProfile', 'available': false, 'message': 'getRetainingPath not available on this VM'});
      return;
    }
    try {
      String? targetId = objectId;
      if (targetId == null && classId != null && _caps['instances'] == true) {
        final Map<String, dynamic>? inst = await _raw('getInstances', <String, dynamic>{'objectId': classId, 'limit': 1}, isolateId: _isolateId);
        final List<dynamic> instances = (inst?['instances'] as List<dynamic>?) ?? <dynamic>[];
        if (instances.isNotEmpty && instances.first is Map) {
          targetId = '${(instances.first as Map)['id']}';
        }
      }
      if (targetId == null) {
        _send(<String, Object?>{'type': 'memoryProfile', 'available': true, 'message': 'Pick a class/object id for retaining path'});
        return;
      }
      final Map<String, dynamic>? path = await _raw('getRetainingPath', <String, dynamic>{'targetId': targetId, 'limit': 20}, isolateId: _isolateId);
      final List<dynamic> elements = (path?['elements'] as List<dynamic>?) ?? <dynamic>[];
      final List<Map<String, Object?>> retainingPath = elements.whereType<Map>().map((Map el) {
        final Object? value = el['value'];
        final String label = value is Map
            ? '${value['className'] ?? value['name'] ?? el['type'] ?? 'object'}'
            : '${el['type'] ?? 'object'}';
        return <String, Object?>{'label': label, 'kind': el['type']};
      }).toList();
      _send(<String, Object?>{
        'type': 'memoryProfile',
        'available': true,
        'retainingPath': retainingPath,
        'message': retainingPath.isEmpty ? 'Empty retaining path' : 'Retaining path',
      });
    } catch (error) {
      _send(<String, Object?>{'type': 'memoryProfile', 'available': false, 'message': '$error'});
    }
  }

  List<Map<String, Object?>> _mapAllocationClasses(vm.AllocationProfile profile) {
    final List<Map<String, Object?>> classes = <Map<String, Object?>>[];
    for (final vm.ClassHeapStats member in profile.members ?? const <vm.ClassHeapStats>[]) {
      final String? name = member.classRef?.name;
      if (name == null || name.isEmpty) continue;
      final int instances = member.instancesCurrent ?? 0;
      final int bytes = member.bytesCurrent ?? 0;
      if (instances <= 0 && bytes <= 0) continue;
      classes.add(<String, Object?>{
        'className': name,
        'instances': instances,
        'bytes': bytes,
        if (member.classRef?.id != null) 'classId': member.classRef!.id,
      });
    }
    classes.sort((Map<String, Object?> a, Map<String, Object?> b) => (b['bytes'] as int).compareTo(a['bytes'] as int));
    return classes.take(40).toList();
  }

  List<Map<String, Object?>> _diffSnapshots(Map<String, Object?> from, Map<String, Object?> to) {
    final Map<String, Map<String, Object?>> fromMap = <String, Map<String, Object?>>{
      for (final Map<String, Object?> c in (from['classes'] as List<dynamic>).cast<Map<String, Object?>>())
        '${c['className']}': c,
    };
    final List<Map<String, Object?>> grew = <Map<String, Object?>>[];
    for (final Map<String, Object?> c in (to['classes'] as List<dynamic>).cast<Map<String, Object?>>()) {
      final Map<String, Object?>? prev = fromMap['${c['className']}'];
      final int instancesDelta = (c['instances'] as int) - ((prev?['instances'] as int?) ?? 0);
      final int bytesDelta = (c['bytes'] as int) - ((prev?['bytes'] as int?) ?? 0);
      if (bytesDelta > 0) {
        grew.add(<String, Object?>{
          'className': c['className'],
          if (c['classId'] != null) 'classId': c['classId'],
          'instancesDelta': instancesDelta,
          'bytesDelta': bytesDelta,
        });
      }
    }
    grew.sort((Map<String, Object?> a, Map<String, Object?> b) => (b['bytesDelta'] as int).compareTo(a['bytesDelta'] as int));
    return grew.take(30).toList();
  }

  // ---------------------------------------------------------------------------
  // Timeline + network control + stress
  // ---------------------------------------------------------------------------

  void _pushMarker(String kind, String label) {
    _timelineMarkers.add(<String, Object?>{
      'id': _uuid(),
      't': DateTime.now().millisecondsSinceEpoch,
      'kind': kind,
      'label': label,
    });
    if (_timelineMarkers.length > 80) {
      _timelineMarkers.removeRange(0, _timelineMarkers.length - 60);
    }
  }

  Future<void> _handleTimelineExport(int durationMs) async {
    if (_mode == 'mock') {
      final String encoded = base64Encode(utf8.encode(jsonEncode(<String, Object?>{
        'demo': true,
        'markers': _timelineMarkers,
        'note': 'Demo Perfetto placeholder — connect a live VM for real traces',
      })));
      _send(<String, Object?>{
        'type': 'timelineExport',
        'available': true,
        'format': 'json',
        'base64': encoded,
        'fileName': 'pulseflow-demo-timeline-${DateTime.now().millisecondsSinceEpoch}.json',
        'markers': _timelineMarkers,
        'message': 'Demo timeline export (JSON placeholder)',
      });
      return;
    }
    if (_mode != 'live') {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect before exporting timeline'});
      return;
    }
    final int extent = (durationMs < 1000 ? 1000 : durationMs) * 1000;
    try {
      if (_caps['perfettoTimeline'] == true) {
        int origin = 0;
        if (_caps['vmTimelineMicros'] == true) {
          final int? end = (await _vm!.getVMTimelineMicros()).timestamp;
          if (end != null) origin = end - extent > 0 ? end - extent : 0;
        }
        final vm.PerfettoTimeline timeline =
            await _vm!.getPerfettoVMTimeline(timeOriginMicros: origin, timeExtentMicros: extent);
        final String? trace = timeline.trace;
        if (trace != null) {
          _send(<String, Object?>{
            'type': 'timelineExport',
            'available': true,
            'format': 'perfetto',
            'base64': trace,
            'fileName': 'pulseflow-perfetto-${DateTime.now().millisecondsSinceEpoch}.pftrace',
            'markers': _timelineMarkers,
            'message': 'Perfetto timeline ready',
          });
          return;
        }
      }
      final Map<String, dynamic>? tl = await _raw('getVMTimeline', <String, dynamic>{
        'timeOriginMicros': 0,
        'timeExtentMicros': extent,
      });
      final String encoded = base64Encode(utf8.encode(jsonEncode(tl ?? <String, Object?>{})));
      _send(<String, Object?>{
        'type': 'timelineExport',
        'available': true,
        'format': 'json',
        'base64': encoded,
        'fileName': 'pulseflow-timeline-${DateTime.now().millisecondsSinceEpoch}.json',
        'markers': _timelineMarkers,
        'message': 'Perfetto RPC unavailable — exported VM timeline JSON instead',
      });
    } catch (error) {
      _send(<String, Object?>{
        'type': 'timelineExport',
        'available': false,
        'format': 'json',
        'markers': _timelineMarkers,
        'message': '$error',
      });
    }
  }

  Future<void> _handleNetworkControl(String action) async {
    if (_mode == 'mock') {
      if (action == 'clear') {
        _send(<String, Object?>{'type': 'network', 'available': true, 'requests': <Object?>[], 'message': 'Mock network buffer cleared'});
        return;
      }
      final List<Map<String, Object?>> demo = List<Map<String, Object?>>.generate(8, (int i) {
        return <String, Object?>{
          'id': _uuid(),
          't': DateTime.now().millisecondsSinceEpoch - (8 - i) * 400,
          'method': i % 3 == 0 ? 'POST' : 'GET',
          'uri': i % 2 == 0 ? '/api/invoices' : '/api/items/$i',
          'latencyMs': double.parse((80 + _rng.nextDouble() * 600).toStringAsFixed(1)),
          'requestBytes': 400 + i * 120,
          'responseBytes': 1200 + i * 300,
          'status': i == 5 ? 500 : 200,
        };
      });
      _send(<String, Object?>{'type': 'network', 'available': true, 'requests': demo, 'request': demo.last, 'message': 'Mock network refresh'});
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect before network control'});
      return;
    }
    if (action == 'clear') {
      _seenHttpIds.clear();
      try {
        await _vm!.callServiceExtension('clearHttpProfile', isolateId: _isolateId);
      } catch (_) {}
      _send(<String, Object?>{
        'type': 'network',
        'available': _httpProfileSupported != false,
        'requests': <Object?>[],
        'message': 'HTTP profile cleared',
      });
      return;
    }
    if (action == 'enable') {
      try {
        await _vm!.callServiceExtension('ext.dart.io.httpEnableTimelineLogging', isolateId: _isolateId, args: <String, dynamic>{'enabled': 'true'});
      } catch (_) {}
    }
    await _pollHttpProfile();
  }

  Future<void> _handleLeakControl(String action, int? threshold, int? limit) async {
    if (action != 'report') {
      // start/stop/reset are accepted for forward compatibility; the app-side
      // leak probe is always active in debug/profile builds.
      _send(<String, Object?>{
        'type': 'leaks',
        'available': true,
        'leaked': <Object?>[],
        'message': 'Leak probe $action acknowledged',
      });
      return;
    }
    if (_mode == 'mock') {
      _send(<String, Object?>{
        'type': 'leaks',
        'available': true,
        'leaked': <Map<String, Object?>>[
          {'className': 'Image', 'count': 3},
          {'className': 'AnimationController', 'count': 2},
          {'className': '_Uint8ArrayView', 'count': 1},
        ],
        'message': 'Demo leak report',
      });
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{
        'type': 'leaks',
        'available': false,
        'leaked': <Object?>[],
        'message': 'Connect before requesting a leak report',
      });
      return;
    }
    if (!_extensionMethods.contains('ext.pulseflow.getLeakReport')) {
      _send(<String, Object?>{
        'type': 'leaks',
        'available': false,
        'leaked': <Object?>[],
        'message': 'Leak probe unavailable — use the pulseflow_flutter package (debug/profile)',
      });
      return;
    }
    try {
      final Map<String, dynamic>? data = await _callExtension(
        'ext.pulseflow.getLeakReport',
        args: <String, dynamic>{
          if (threshold != null) 'threshold': '$threshold',
          if (limit != null) 'limit': '$limit',
        },
      );
      final bool available = data?['available'] != false;
      final List<dynamic> leaked = (data?['leaked'] as List<dynamic>?) ?? <dynamic>[];
      _send(<String, Object?>{
        'type': 'leaks',
        'available': available,
        'leaked': leaked
            .whereType<Map>()
            .map((Map m) => m.cast<String, Object?>())
            .toList(),
        if (data?['message'] != null) 'message': data!['message'],
      });
    } catch (error) {
      _send(<String, Object?>{
        'type': 'leaks',
        'available': false,
        'leaked': <Object?>[],
        'message': '$error',
      });
    }
  }

  Future<void> _handleDebugOptions(String action, String? id, bool? enabled) async {
    if (_mode == 'mock') {
      if (action == 'set' && id != null && enabled != null && _mockDebugOptions.containsKey(id)) {
        _mockDebugOptions[id] = enabled;
      }
      _emitMockDebugOptions(
        message: action == 'set' && id != null
            ? 'Demo: $id ${enabled == true ? 'on' : 'off'} (no device overlay)'
            : 'Demo debug options — toggles are local only',
      );
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{
        'type': 'debugOptions',
        'options': <Object?>[],
        'message': 'Connect to a Flutter app to use debug overlays',
      });
      return;
    }

    if (action == 'set') {
      if (id == null || enabled == null) {
        _send(<String, Object?>{'type': 'error', 'message': 'debugOptions set requires id and enabled'});
        return;
      }
      Map<String, String>? def;
      for (final Map<String, String> d in _debugOptionDefs) {
        if (d['id'] == id) {
          def = d;
          break;
        }
      }
      if (def == null) {
        _send(<String, Object?>{'type': 'error', 'message': 'Unknown debug option: $id'});
        return;
      }
      final String method = def['method']!;
      if (!_extensionMethods.contains(method)) {
        _send(<String, Object?>{
          'type': 'error',
          'message': '$method is not available on this isolate (needs a debug/profile Flutter app)',
        });
        await _readLiveDebugOptions(message: 'Some Flutter debug extensions are unavailable');
        return;
      }
      try {
        if (def['kind'] == 'timeDilation') {
          await _callExtension(
            method,
            args: <String, dynamic>{
              'timeDilation': enabled ? '$_slowAnimationDilation' : '1.0',
            },
          );
        } else {
          await _callExtension(
            method,
            args: <String, dynamic>{'enabled': '$enabled'},
          );
        }
      } catch (error) {
        _send(<String, Object?>{'type': 'error', 'message': '$error'});
      }
      await _readLiveDebugOptions(
        message: '${def['id']} ${enabled ? 'enabled' : 'disabled'}',
      );
      return;
    }

    await _readLiveDebugOptions();
  }

  Future<void> _readLiveDebugOptions({String? message}) async {
    final List<Map<String, Object?>> options = <Map<String, Object?>>[];
    for (final Map<String, String> def in _debugOptionDefs) {
      final String method = def['method']!;
      final bool available = _extensionMethods.contains(method);
      bool enabled = false;
      if (available) {
        try {
          final Map<String, dynamic>? result = await _callExtension(method);
          if (def['kind'] == 'timeDilation') {
            final double dilation =
                double.tryParse('${result?['timeDilation'] ?? result?['value'] ?? 1}') ?? 1.0;
            enabled = dilation > 1.0;
          } else {
            enabled = _parseBoolFlag(result?['enabled']);
          }
        } catch (_) {
          options.add(<String, Object?>{
            'id': def['id'],
            'enabled': false,
            'available': false,
          });
          continue;
        }
      }
      options.add(<String, Object?>{
        'id': def['id'],
        'enabled': enabled,
        'available': available,
      });
    }
    _send(<String, Object?>{
      'type': 'debugOptions',
      'options': options,
      if (message != null) 'message': message,
    });
  }

  void _emitMockDebugOptions({String? message}) {
    _send(<String, Object?>{
      'type': 'debugOptions',
      'options': _debugOptionDefs
          .map(
            (Map<String, String> d) => <String, Object?>{
              'id': d['id'],
              'enabled': _mockDebugOptions[d['id']!] ?? false,
              'available': true,
            },
          )
          .toList(),
      'message': message ?? 'Demo debug options — toggles are local only',
    });
  }

  bool _parseBoolFlag(Object? value) {
    if (value is bool) return value;
    if (value is String) return value.toLowerCase() == 'true';
    return false;
  }

  Future<void> _runStress(String action, Map<String, dynamic>? params) async {
    if (_mode == 'mock') {
      _mockStress(action);
      return;
    }
    if (_mode != 'live' || _isolateId == null) {
      _send(<String, Object?>{'type': 'error', 'message': 'Connect to a Flutter VM Service (or start demo mode) before running stress tests'});
      return;
    }
    final Map<String, String> methodMap = <String, String>{
      'injectInvoices': 'ext.pulseflow.injectInvoices',
      'spikeCpu': 'ext.pulseflow.spikeCpu',
      'allocateMemory': 'ext.pulseflow.allocateMemory',
    };
    final String method = methodMap[action] ?? action;
    if (!_extensionMethods.contains(method)) {
      _send(<String, Object?>{
        'type': 'extension',
        'info': {
          'available': false,
          'methods': _extensionMethods.where((String m) => m.startsWith('ext.pulseflow.')).toList(),
          'message': 'Extension $method unavailable — add the PulseFlow stub to your Flutter app',
        },
      });
      _send(<String, Object?>{'type': 'error', 'message': 'Stress action unavailable: $method is not registered on the isolate'});
      return;
    }
    try {
      await _callExtension(method, args: (params ?? <String, dynamic>{'count': 100}).map((String k, dynamic v) => MapEntry<String, dynamic>(k, '$v')));
      _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'live', 'message': 'Stress RPC $method completed'});
    } catch (error) {
      _send(<String, Object?>{'type': 'error', 'message': '$error'});
    }
  }

  // ---------------------------------------------------------------------------
  // Mock mode
  // ---------------------------------------------------------------------------

  void _startMock() {
    _disconnectVm();
    _mode = 'mock';
    _widgetProbeAvailable = true;
    _hotWidgetsFrozen = false;
    _recordQuietUntil = 0;
    _mockSessionRebuilds.clear();
    _lastHotPayload = null;
    _caps = _mockCaps();
    _memorySnapshots.clear();
    _seenHttpIds.clear();
    _timelineMarkers.clear();
    _send(<String, Object?>{
      'type': 'status',
      'status': 'connected',
      'mode': 'mock',
      'message': 'Demo mode — synthetic metrics (no Flutter app connected)',
      'isolateName': 'mock-isolate',
    });
    _send(<String, Object?>{'type': 'capabilities', 'caps': _caps, 'message': 'Demo capabilities — all lab surfaces enabled with fake data'});
    _sendMockExtension();
    _send(<String, Object?>{'type': 'scenarioStatus', 'scenarios': mockScenarios, 'running': null, 'message': 'Demo scenarios ready'});
    _send(<String, Object?>{'type': 'network', 'available': true, 'message': 'Mock network profile enabled'});
    _send(<String, Object?>{
      'type': 'buildInfo',
      'buildMode': 'debug',
      'probes': <String, bool>{
        'rebuildProbe': true,
        'sourceLocations': true,
        'errors': true,
        'images': true,
        'leaks': true,
        'stalls': true,
        'deviceContext': true,
      },
    });
    _emitMockDeviceContext();
    _emitMockStalls();
    for (final String id in _mockDebugOptions.keys) {
      _mockDebugOptions[id] = false;
    }
    _emitMockDebugOptions();
    _emitMockHotWidgets();
    _emitMockRebuildCauses();
    _emitMockErrors();
    _emitMockImages();
    _emitMockLogs();
    _mockTimer = Timer.periodic(const Duration(milliseconds: 500), (_) => _emitMockMetrics());
    _hotTimer = Timer.periodic(const Duration(milliseconds: 1000), (_) {
      _emitMockHotWidgets();
      _emitMockRebuildCauses();
      _emitMockErrors();
      _emitMockImages();
      _emitMockStalls();
    });
  }

  void _emitMockDeviceContext() {
    _send(<String, Object?>{
      'type': 'deviceContext',
      'available': true,
      'platform': 'android',
      'buildMode': 'debug',
      'locale': 'en-US',
      'textScale': 1.0,
      'appPackage': 'demo_app',
      'display': <String, Object?>{
        'refreshRate': 60,
        'budgetMs': defaultFrameBudgetMs,
        'devicePixelRatio': 2.75,
        'physicalWidth': 1080,
        'physicalHeight': 2400,
      },
      'extras': <String, Object?>{'demo': true},
    });
  }

  void _emitMockStalls() {
    final int t = DateTime.now().millisecondsSinceEpoch;
    final bool spike = _rng.nextDouble() > 0.85;
    _send(<String, Object?>{
      'type': 'stalls',
      'available': true,
      'active': true,
      'thresholdMs': 250,
      'total': spike ? 1 : 0,
      'maxDurationMs': spike ? 320 + _rng.nextDouble() * 200 : 0,
      'stalls': spike
          ? <Object?>[
              <String, Object?>{
                'id': 'stall-mock-$t',
                'durationMs': round2(320 + _rng.nextDouble() * 200),
                'atMs': t,
                'route': '/home',
              },
            ]
          : <Object?>[],
    });
  }

  void _sendMockExtension() {
    _send(<String, Object?>{
      'type': 'extension',
      'info': {
        'available': true,
        'methods': <String>[
          'ext.pulseflow.injectInvoices',
          'ext.pulseflow.spikeCpu',
          'ext.pulseflow.allocateMemory',
          'ext.pulseflow.getHotWidgets',
          'ext.pulseflow.listScenarios',
          'ext.pulseflow.runScenario',
          'ext.pulseflow.stopScenario',
          'ext.pulseflow.getDeviceContext',
          'ext.pulseflow.getStallReport',
        ],
        'message': 'Mock stress actions and hot widgets simulate load locally',
      },
    });
  }

  void _emitMockMetrics() {
    final int t = DateTime.now().millisecondsSinceEpoch;
    final double wave = sin(t / 900) * 18 + sin(t / 2400) * 10;
    final double spike = _rng.nextDouble() > 0.92 ? 20 + _rng.nextDouble() * 40 : 0;
    final double buildMs = max(2, 6 + wave * 0.12 + spike * 0.35 + _rng.nextDouble() * 2);
    final double rasterMs = max(1.5, 4 + wave * 0.08 + spike * 0.2 + _rng.nextDouble() * 1.5);
    final double vsyncMs = max(0.2, 0.8 + _rng.nextDouble() * 0.6);
    final double frameMs = buildMs + rasterMs + vsyncMs * 0.3;
    final double heapMb = 42 + sin(t / 5000) * 6 + _rng.nextDouble() * 2 + (spike > 0 ? 8 : 0);
    lastFrameMs = frameMs;
    lastBuildMs = buildMs;
    lastRasterMs = rasterMs;
    lastVsyncMs = vsyncMs;
    _send(<String, Object?>{
      'type': 'metrics',
      'point': {
        't': t,
        'cpu': framePressure(buildMs, rasterMs, frameMs),
        'framePressure': framePressure(buildMs, rasterMs, frameMs),
        'frameMs': round2(frameMs),
        'buildMs': round2(buildMs),
        'rasterMs': round2(rasterMs),
        'vsyncMs': round2(vsyncMs),
        'jank': frameMs > defaultFrameBudgetMs ? 1 : 0,
        'heapMb': round2(heapMb),
        'externalMb': round2(8 + _rng.nextDouble() * 2),
        'refreshRate': 60,
        'buildBudgetMs': defaultFrameBudgetMs,
      },
    });
    if (_rng.nextDouble() > 0.94) {
      _send(<String, Object?>{
        'type': 'gc',
        'event': {'id': _uuid(), 't': t, 'reason': _rng.nextBool() ? 'scavenge' : 'mark-sweep', 'isolate': 'main'},
      });
    }
    if (_rng.nextDouble() > 0.88) {
      final double latency = 40 + _rng.nextDouble() * 180 + (spike > 0 ? 120 : 0);
      _send(<String, Object?>{
        'type': 'network',
        'available': true,
        'request': {
          'id': _uuid(),
          't': t,
          'method': <String>['GET', 'POST', 'PUT'][_rng.nextInt(3)],
          'uri': '/api/invoices?page=${_rng.nextInt(8)}',
          'latencyMs': double.parse(latency.toStringAsFixed(1)),
          'requestBytes': 120 + _rng.nextInt(800),
          'responseBytes': 900 + _rng.nextInt(24000),
          'status': _rng.nextDouble() > 0.95 ? 500 : 200,
        },
      });
    }
  }

  void _emitMockHotWidgets() {
    if (_hotWidgetsFrozen) return;
    if (DateTime.now().millisecondsSinceEpoch < _recordQuietUntil) return;
    const int windowMs = 10000;
    const double windowSec = windowMs / 1000;
    final bool duringJank = lastFrameMs > defaultFrameBudgetMs;
    final List<Map<String, Object?>> widgets = <Map<String, Object?>>[];
    for (final Map<String, Object?> def in _mockWidgetDefs) {
      final String id = '${def['route']}|${def['name']}|${def['keyLabel'] ?? ''}';
      final int rebuildsWindow = max(
        0,
        ((def['base'] as int) - _rng.nextInt(8) + (duringJank ? 10 : 0)),
      );
      final int prev = _mockSessionRebuilds[id] ?? 0;
      final int session = prev + rebuildsWindow;
      _mockSessionRebuilds[id] = session;
      widgets.add(<String, Object?>{
        'id': id,
        'name': def['name'],
        'route': def['route'],
        if (def['keyLabel'] != null) 'keyLabel': def['keyLabel'],
        'rebuildsSession': session,
        'rebuildsWindow': rebuildsWindow,
        'ratePerSec': double.parse((rebuildsWindow / windowSec).toStringAsFixed(2)),
        'share': 0.0,
        'lastSeenMs': _rng.nextInt(800),
        'isFramework': def['isFramework'] == true,
        'duringJank': duringJank,
      });
    }
    final int totalWindow = widgets.fold<int>(0, (int a, Map<String, Object?> w) => a + (w['rebuildsWindow'] as int));
    final int totalSession = widgets.fold<int>(0, (int a, Map<String, Object?> w) => a + (w['rebuildsSession'] as int));
    for (final Map<String, Object?> w in widgets) {
      w['share'] = totalWindow > 0 ? double.parse((((w['rebuildsWindow'] as int) / totalWindow) * 100).toStringAsFixed(1)) : 0.0;
    }
    widgets.sort((Map<String, Object?> a, Map<String, Object?> b) => (b['rebuildsWindow'] as int).compareTo(a['rebuildsWindow'] as int));
    final Map<String, List<Map<String, Object?>>> byRoute = <String, List<Map<String, Object?>>>{};
    for (final Map<String, Object?> w in widgets) {
      byRoute.putIfAbsent(w['route']! as String, () => <Map<String, Object?>>[]).add(w);
    }
    final List<Map<String, Object?>> screens = byRoute.entries.map((MapEntry<String, List<Map<String, Object?>>> e) {
      final int rebuildsWindow = e.value.fold<int>(0, (int a, Map<String, Object?> w) => a + (w['rebuildsWindow'] as int));
      return <String, Object?>{
        'route': e.key,
        'rebuildsWindow': rebuildsWindow,
        'ratePerSec': double.parse((rebuildsWindow / windowSec).toStringAsFixed(2)),
        'share': totalWindow > 0 ? double.parse(((rebuildsWindow / totalWindow) * 100).toStringAsFixed(1)) : 0.0,
        'topWidgets': e.value.take(5).toList(),
      };
    }).toList()
      ..sort((Map<String, Object?> a, Map<String, Object?> b) => (b['rebuildsWindow'] as int).compareTo(a['rebuildsWindow'] as int));

    final Map<String, Object?> payload = <String, Object?>{
      'type': 'hotWidgets',
      'available': true,
      'windowMs': windowMs,
      'totalRebuildsWindow': totalWindow,
      'totalRebuildsSession': totalSession,
      'totalRebuilds': totalWindow,
      'widgets': widgets,
      'screens': screens,
      'frozen': _hotWidgetsFrozen,
      'duringJank': duringJank,
      'message': 'Demo widget rebuild ranks',
    };
    _lastHotPayload = payload;
    _send(payload);
  }

  void _emitMockRebuildCauses() {
    if (_hotWidgetsFrozen) return;
    _send(<String, Object?>{
      'type': 'rebuildCauses',
      'available': true,
      'windowMs': 10000,
      'roots': <Map<String, Object?>>[
        {
          'id': '/invoices|InvoiceListState|',
          'widget': 'InvoiceListState',
          'route': '/invoices',
          'cause': 'self',
          'rebuilds': 36,
          'ratePerSec': 3.6,
          'children': 2,
        },
        {
          'id': '/dashboard|DashboardScope|',
          'widget': 'DashboardScope',
          'route': '/dashboard',
          'cause': 'self',
          'rebuilds': 18,
          'ratePerSec': 1.8,
          'children': 1,
        },
      ],
      'attributed': <Map<String, Object?>>[
        {'widget': 'InvoiceCard', 'root': 'InvoiceListState', 'count': 24},
        {'widget': 'InvoiceListTile', 'root': 'InvoiceListState', 'count': 12},
        {'widget': 'AnimatedBuilder', 'root': 'DashboardScope', 'count': 18},
      ],
    });
  }

  void _emitMockErrors() {
    _send(<String, Object?>{
      'type': 'errors',
      'available': true,
      'total': 3,
      'errors': <Map<String, Object?>>[
        {
          'kind': 'overflow',
          'signature': 'A RenderFlex overflowed by 24 pixels on the right',
          'count': 2,
          'route': '/invoices',
          'top': <String>['#0 RenderFlex.performLayout', '#1 RenderObject.layout'],
        },
        {
          'kind': 'exception',
          'signature': 'Bad state: no element',
          'count': 1,
          'route': '/reports',
          'top': <String>['#0 List.firstWhere'],
        },
      ],
    });
  }

  void _emitMockImages() {
    _send(<String, Object?>{
      'type': 'images',
      'available': true,
      'cache': <String, Object?>{
        'currentSizeBytes': 12 * 1024 * 1024,
        'currentSize': 9,
        'maximumSizeBytes': 100 * 1024 * 1024,
        'live': 4,
        'pending': 0,
      },
      'oversized': <Map<String, Object?>>[
        {
          'source': 'assets/hero.png',
          'decodedBytes': 4194304,
          'displayBytes': 65536,
          'overheadBytes': 4128768,
          'count': 12,
        },
        {
          'source': 'https://cdn.example.com/banner.jpg',
          'decodedBytes': 2097152,
          'displayBytes': 131072,
          'overheadBytes': 1966080,
          'count': 6,
        },
      ],
    });
  }

  final List<Map<String, Object?>> _mockLogSequence = <Map<String, Object?>>[
    <String, Object?>{
      "t": DateTime(2026, 1, 1).millisecondsSinceEpoch,
      "level": "debug",
      "severity": 500,
      "loggerName": "main",
      "message": "PulseFlow attached — monitoring 3 isolates",
    },
    <String, Object?>{
      "t": DateTime(2026, 1, 1).millisecondsSinceEpoch,
      "level": "info",
      "severity": 800,
      "loggerName": "flutter.ui",
      "message": "I/surface: skipping frame as the surface is not available",
    },
    <String, Object?>{
      "t": DateTime(2026, 1, 1).millisecondsSinceEpoch,
      "level": "warning",
      "severity": 900,
      "loggerName": "dart",
      "message": "This widget creates a RepaintBoundary but also receives non-zero translation offsets",
    },
    <String, Object?>{
      "t": DateTime(2026, 1, 1).millisecondsSinceEpoch,
      "level": "error",
      "severity": 1000,
      "loggerName": "main",
      "message": "MissingPluginException(No implementation found for method getBatteryLevel)",
    },
  ];

  void _emitMockLogs() {
    for (final Map<String, Object?> entry in _mockLogSequence) {
      _send(<String, Object?>{
        "type": "log",
        "entry": entry,
      });
    }
  }

  void _mockHotWidgetsControl(String action) {
    if (action == 'freeze') {
      _hotWidgetsFrozen = true;
      _sendFrozenAck('Frozen — demo ranks held still');
      _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'mock', 'message': 'Widget probe frozen'});
    } else if (action == 'unfreeze') {
      _hotWidgetsFrozen = false;
      _emitMockHotWidgets();
      _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'mock', 'message': 'Widget probe unfrozen'});
    } else {
      _hotWidgetsFrozen = false;
      _mockSessionRebuilds.clear();
      _lastHotPayload = null;
      _recordQuietUntil = DateTime.now().millisecondsSinceEpoch + 2500;
      _sendClearedHotWidgets('Recording — counters cleared, waiting for new samples…');
      _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'mock', 'message': 'Recording — session cleared'});
    }
  }

  void _mockScenario(String action, String? id, Map<String, dynamic>? params) {
    if (action == 'list') {
      _send(<String, Object?>{'type': 'scenarioStatus', 'scenarios': mockScenarios, 'running': _scenarioRunning, 'message': 'Demo scenarios'});
      return;
    }
    if (action == 'stop') {
      _scenarioTimer?.cancel();
      _scenarioTimer = null;
      final String? stopped = _scenarioRunning;
      _scenarioRunning = null;
      _send(<String, Object?>{
        'type': 'scenarioStatus',
        'scenarios': mockScenarios,
        'running': null,
        'result': {'id': stopped ?? 'unknown', 'ok': true, 'stopped': true},
        'message': 'Demo scenario stopped',
      });
      return;
    }
    final String scenarioId = id ?? 'scrollStorm';
    _scenarioRunning = scenarioId;
    _send(<String, Object?>{'type': 'scenarioStatus', 'scenarios': mockScenarios, 'running': scenarioId, 'message': 'Demo scenario $scenarioId running'});
    int bursts = 0;
    final Timer spike = Timer.periodic(const Duration(milliseconds: 250), (Timer timer) {
      bursts += 1;
      _emitMockMetrics();
      if (bursts >= 12) timer.cancel();
    });
    _scenarioTimer = Timer(const Duration(seconds: 3), () {
      spike.cancel();
      _scenarioRunning = null;
      _send(<String, Object?>{
        'type': 'scenarioStatus',
        'scenarios': mockScenarios,
        'running': null,
        'result': {'id': scenarioId, 'ok': true, 'durationMs': 3000, 'stubbed': scenarioId == 'networkBurst', 'message': 'Demo scenario finished'},
      });
    });
  }

  void _mockMemory(String action, String? snapshotId) {
    if (action == 'capture') {
      final int n = _memorySnapshots.length;
      final Map<String, Object?> snap = <String, Object?>{
        'id': _uuid(),
        't': DateTime.now().millisecondsSinceEpoch,
        'heapMb': 48 + n * 12,
        'externalMb': 10 + n * 2,
        'classes': <Map<String, Object?>>[
          {'className': 'Invoice', 'instances': 120 + n * 80, 'bytes': (120 + n * 80) * 256},
          {'className': '_Uint8ArrayView', 'instances': 40 + n * 20, 'bytes': (32 + n * 16) * 1024 * 1024},
          {'className': 'Image', 'instances': 18 + n * 4, 'bytes': (6 + n * 2) * 1024 * 1024},
          {'className': 'String', 'instances': 4000 + n * 500, 'bytes': (2 + n) * 1024 * 1024},
        ],
      };
      _memorySnapshots.add(snap);
      if (_memorySnapshots.length > 4) _memorySnapshots.removeAt(0);
      _send(<String, Object?>{'type': 'memoryProfile', 'available': true, 'snapshot': snap, 'message': 'Demo snapshot ${_memorySnapshots.length} captured'});
      return;
    }
    if (action == 'diff') {
      if (_memorySnapshots.length < 2) {
        _send(<String, Object?>{'type': 'memoryProfile', 'available': true, 'message': 'Capture two snapshots to diff'});
        return;
      }
      final Map<String, Object?> from = _memorySnapshots[_memorySnapshots.length - 2];
      final Map<String, Object?> to = _memorySnapshots.last;
      _send(<String, Object?>{
        'type': 'memoryProfile',
        'available': true,
        'diff': {'fromId': from['id'], 'toId': to['id'], 'grew': _diffSnapshots(from, to)},
        'message': 'Demo memory diff',
      });
      return;
    }
    _send(<String, Object?>{
      'type': 'memoryProfile',
      'available': true,
      'retainingPath': <Map<String, Object?>>[
        {'label': 'InvoiceListState', 'kind': 'Instance'},
        {'label': 'invoices', 'kind': 'Field'},
        {'label': 'Invoice', 'kind': 'Instance'},
      ],
      'message': 'Demo retaining path',
    });
  }

  void _mockStress(String action) {
    int bursts = 0;
    Timer.periodic(const Duration(milliseconds: 200), (Timer timer) {
      bursts += 1;
      final int t = DateTime.now().millisecondsSinceEpoch;
      final double buildMs = 18 + _rng.nextDouble() * 24;
      final double rasterMs = 10 + _rng.nextDouble() * 16;
      final double frameMs = buildMs + rasterMs;
      _send(<String, Object?>{
        'type': 'metrics',
        'point': {
          't': t,
          'cpu': framePressure(buildMs, rasterMs, frameMs),
          'framePressure': framePressure(buildMs, rasterMs, frameMs),
          'frameMs': round2(frameMs),
          'buildMs': round2(buildMs),
          'rasterMs': round2(rasterMs),
          'vsyncMs': round2(1 + _rng.nextDouble()),
          'jank': 1,
          'heapMb': round2(55 + bursts * 1.5 + _rng.nextDouble() * 3),
          'externalMb': round2(12 + _rng.nextDouble() * 2),
        },
      });
      if (action.contains('invoice') || action == 'injectInvoices') {
        _send(<String, Object?>{
          'type': 'network',
          'available': true,
          'request': {
            'id': _uuid(),
            't': t,
            'method': 'POST',
            'uri': '/api/invoices/bulk',
            'latencyMs': double.parse((180 + _rng.nextDouble() * 220).toStringAsFixed(1)),
            'requestBytes': 12000 + bursts * 800,
            'responseBytes': 2400,
            'status': 201,
          },
        });
      }
      if (bursts >= 8) timer.cancel();
    });
    _send(<String, Object?>{'type': 'status', 'status': 'connected', 'mode': 'mock', 'message': 'Mock stress "$action" fired'});
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  Future<Map<String, dynamic>?> _raw(
    String method,
    Map<String, dynamic> args, {
    String? isolateId,
    Duration timeout = const Duration(milliseconds: 8000),
  }) async {
    final vm.VmService? service = _vm;
    if (service == null) throw StateError('VM Service is not connected');
    final vm.Response response = await service
        .callServiceExtension(method, isolateId: isolateId, args: args)
        .timeout(timeout);
    return response.json;
  }

  Future<Map<String, dynamic>?> _callExtension(
    String method, {
    Map<String, dynamic>? args,
    Duration timeout = const Duration(milliseconds: 8000),
  }) async {
    final Map<String, dynamic>? result =
        await _raw(method, args ?? <String, dynamic>{}, isolateId: _isolateId, timeout: timeout);
    if (result == null) return null;
    final Object? json = result['json'];
    if (json is String) {
      final Object? decoded = jsonDecode(json);
      return decoded is Map ? decoded.cast<String, dynamic>() : null;
    }
    return result;
  }

  String _uuid() {
    final int a = DateTime.now().microsecondsSinceEpoch;
    final int b = _rng.nextInt(1 << 32);
    return '${a.toRadixString(16)}-${b.toRadixString(16)}';
  }
}
