import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// A local Dart/Flutter VM Service endpoint found by discovery.
class DiscoveredApp {
  DiscoveredApp({
    required this.id,
    required this.name,
    required this.wsUrl,
    required this.httpUrl,
    required this.port,
    required this.source,
    required this.connectable,
    this.isolateName,
    this.detail,
    this.deviceName,
  });

  final String id;
  final String name;
  final String wsUrl;
  final String httpUrl;
  final int port;
  final String source;
  final String? isolateName;
  final bool connectable;
  final String? detail;
  final String? deviceName;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'name': name,
        'wsUrl': wsUrl,
        'httpUrl': httpUrl,
        'port': port,
        'source': source,
        'connectable': connectable,
        if (isolateName != null) 'isolateName': isolateName,
        if (detail != null) 'detail': detail,
        if (deviceName != null) 'deviceName': deviceName,
      };
}

class _AdbForward {
  _AdbForward(this.serial, this.localPort, this.deviceName);
  final String serial;
  final int localPort;
  final String deviceName;
}

class _FlutterRunHint {
  _FlutterRunHint(this.deviceId, this.appName);
  final String deviceId;
  final String appName;
}

class _DdsHint {
  _DdsHint({
    required this.vmServiceHttpUrl,
    required this.vmPort,
    required this.authCode,
    this.appName,
    this.deviceName,
  });

  final String vmServiceHttpUrl;
  final int vmPort;
  final String authCode;
  final String? appName;
  final String? deviceName;
}

class _Probe {
  _Probe(this.isolateName, this.vmName);
  final String? isolateName;
  final String? vmName;
}

const Set<int> _skipPorts = <int>{
  22, 80, 443, 3000, 3001, 5173, 8080, 8081, 8888, 9000, 9100, 3846, 3847,
};

const int _discoverTimeoutMs = 8000;

String toWsUrl(String input) {
  final Uri uri = Uri.parse(input);
  final String scheme = uri.scheme == 'https' ? 'wss' : 'ws';
  String path = uri.path.isEmpty ? '/' : uri.path;
  if (path.endsWith('/ws') || path.endsWith('/ws/')) {
    path = path.replaceAll(RegExp(r'/+$'), '');
    return uri.replace(scheme: scheme, path: path).toString();
  }
  if (!path.endsWith('/')) path += '/';
  return uri.replace(scheme: scheme, path: '${path}ws').toString();
}

String toHttpUrl(String host, int port, [String authCode = '']) {
  String auth = authCode.trim();
  if (auth.isNotEmpty && !auth.endsWith('/')) auth += '/';
  if (auth.startsWith('/')) auth = auth.substring(1);
  return 'http://$host:$port/$auth';
}

String _appId(String wsUrl) => wsUrl.replaceAll(RegExp(r'/+$'), '');

Map<String, dynamic>? _pickMain(List<dynamic> isolates) {
  Map<String, dynamic>? main;
  Map<String, dynamic>? nonSystem;
  for (final dynamic raw in isolates) {
    if (raw is! Map) continue;
    final Map<String, dynamic> iso = raw.cast<String, dynamic>();
    if (iso['isSystemIsolate'] == true) continue;
    nonSystem ??= iso;
    if (RegExp('main', caseSensitive: false).hasMatch('${iso['name']}')) {
      main = iso;
      break;
    }
  }
  if (main != null) return main;
  if (nonSystem != null) return nonSystem;
  return isolates.isNotEmpty && isolates.first is Map
      ? (isolates.first as Map).cast<String, dynamic>()
      : null;
}

Future<List<String>> _run(String exe, List<String> args, int timeoutMs) async {
  try {
    final ProcessResult result = await Process.run(exe, args)
        .timeout(Duration(milliseconds: timeoutMs));
    if (result.exitCode != 0) return const <String>[];
    return '${result.stdout}'.split('\n');
  } catch (_) {
    return const <String>[];
  }
}

List<Map<String, String>> _parseProcPorts(String content, bool ipv6) {
  final List<Map<String, String>> out = <Map<String, String>>[];
  final List<String> lines = content.split('\n');
  for (int i = 1; i < lines.length; i++) {
    final List<String> cols = lines[i].trim().split(RegExp(r'\s+'));
    if (cols.length < 10) continue;
    if (cols[3] != '0A') continue;
    final List<String> local = cols[1].split(':');
    if (local.length < 2) continue;
    final int port = int.tryParse(local[1], radix: 16) ?? -1;
    if (port <= 0) continue;
    const String localV4a = '0100007F';
    const String localV4b = '00000000';
    const String localV6a = '00000000000000000000000001000000';
    const String localV6b = '00000000000000000000000000000000';
    final bool isLocal = ipv6
        ? (local[0] == localV6a || local[0] == localV6b)
        : (local[0] == localV4a || local[0] == localV4b);
    if (!isLocal) continue;
    out.add(<String, String>{'port': '$port'});
  }
  return out;
}

Future<List<int>> _listListeningPorts() async {
  final Set<int> ports = <int>{};
  try {
    final String tcp = await File('/proc/net/tcp').readAsString();
    for (final Map<String, String> p in _parseProcPorts(tcp, false)) {
      ports.add(int.parse(p['port']!));
    }
  } catch (_) {}
  try {
    final String tcp6 = await File('/proc/net/tcp6').readAsString();
    for (final Map<String, String> p in _parseProcPorts(tcp6, true)) {
      ports.add(int.parse(p['port']!));
    }
  } catch (_) {}
  final List<int> list = ports.where((int p) => !_skipPorts.contains(p)).toList()
    ..sort();
  return list;
}

Future<Map<String, String>> _listAdbDevices() async {
  final Map<String, String> devices = <String, String>{};
  for (final String line in (await _run('adb', <String>['devices', '-l'], 2500)).skip(1)) {
    final String trimmed = line.trim();
    if (trimmed.isEmpty || trimmed.startsWith('*')) continue;
    final List<String> parts = trimmed.split(RegExp(r'\s+'));
    if (parts.length < 2 || parts[1] != 'device') continue;
    final RegExpMatch? model = RegExp(r'model:(\S+)').firstMatch(trimmed);
    final RegExpMatch? device = RegExp(r'device:(\S+)').firstMatch(trimmed);
    devices[parts[0]] =
        (model?.group(1) ?? device?.group(1) ?? parts[0]).replaceAll('_', ' ');
  }
  return devices;
}

Future<Map<int, _AdbForward>> _listAdbForwards() async {
  final Map<int, _AdbForward> byPort = <int, _AdbForward>{};
  final Map<String, String> devices = await _listAdbDevices();
  for (final String line in await _run('adb', <String>['forward', '--list'], 2500)) {
    final RegExpMatch? m =
        RegExp(r'^(\S+)\s+tcp:(\d+)\s+tcp:(\d+)\s*$').firstMatch(line.trim());
    if (m == null) continue;
    final int localPort = int.parse(m.group(2)!);
    byPort[localPort] = _AdbForward(
      m.group(1)!,
      localPort,
      devices[m.group(1)!] ?? m.group(1)!,
    );
  }
  return byPort;
}

Future<List<_FlutterRunHint>> _listFlutterRunHints() async {
  final List<_FlutterRunHint> hints = <_FlutterRunHint>[];
  try {
    final List<FileSystemEntity> entries = await Directory('/proc').list().toList();
    for (final FileSystemEntity entry in entries) {
      final String pid = entry.uri.pathSegments.where((String s) => s.isNotEmpty).last;
      if (!RegExp(r'^\d+$').hasMatch(pid)) continue;
      String cmdline;
      try {
        cmdline = (await File('/proc/$pid/cmdline').readAsBytes()).toString();
      } catch (_) {
        continue;
      }
      final String spaced = cmdline.replaceAll('\u0000', ' ');
      if (!spaced.contains('flutter_tools.snapshot') || !spaced.contains('run')) {
        continue;
      }
      final List<String> args = cmdline.split('\u0000').where((String a) => a.isNotEmpty).toList();
      String deviceId = '';
      String target = '';
      for (int i = 0; i < args.length; i++) {
        if ((args[i] == '-d' || args[i] == '--device-id') && i + 1 < args.length) {
          deviceId = args[i + 1];
        }
        if ((args[i] == '--target' || args[i] == '-t') && i + 1 < args.length) {
          target = args[i + 1];
        }
        if (args[i].startsWith('--target=')) {
          target = args[i].substring('--target='.length);
        }
      }
      if (deviceId.isEmpty && target.isEmpty) continue;
      String appName = 'Flutter app';
      if (target.isNotEmpty) {
        final List<String> segs = target.split('/');
        if (segs.length >= 3) {
          appName = segs[segs.length - 3];
        }
      }
      hints.add(_FlutterRunHint(deviceId, appName));
    }
  } catch (_) {}
  return hints;
}

String _displayNameForPort({
  required int port,
  String? isolateName,
  String? vmName,
  _AdbForward? adb,
  required List<_FlutterRunHint> flutterHints,
  required bool needsAuth,
}) {
  if (isolateName != null && !RegExp('^main\$', caseSensitive: false).hasMatch(isolateName)) {
    return isolateName;
  }
  _FlutterRunHint? hint;
  if (adb != null) {
    for (final _FlutterRunHint h in flutterHints) {
      if (h.deviceId.isNotEmpty && h.deviceId == adb.serial) {
        hint = h;
        break;
      }
    }
    hint ??= flutterHints.isNotEmpty ? flutterHints.first : null;
  }
  if (adb != null) {
    final List<String> parts = <String>[
      if (hint != null) hint.appName,
      adb.deviceName,
    ].where((String s) => s.isNotEmpty).toList();
    if (parts.isNotEmpty) return parts.join(' · ');
  }
  if (isolateName != null) return isolateName;
  if (vmName != null && !RegExp('vm', caseSensitive: false).hasMatch(vmName)) {
    return vmName;
  }
  return needsAuth ? 'Dart VM :$port' : 'Flutter :$port';
}

Future<_Probe?> probeVmOverWs(String wsUrl, int timeoutMs) async {
  WebSocket? ws;
  StreamSubscription<dynamic>? sub;
  try {
    ws = await WebSocket.connect(wsUrl).timeout(Duration(milliseconds: timeoutMs));
    final Completer<_Probe?> completer = Completer<_Probe?>();
    void finish(_Probe? value) {
      if (!completer.isCompleted) completer.complete(value);
    }

    sub = ws.listen(
      (dynamic data) {
        try {
          final Map<String, dynamic> msg =
              (jsonDecode('$data') as Map).cast<String, dynamic>();
          if (msg['id'] != '1') return;
          final Map<String, dynamic>? result =
              (msg['result'] as Map?)?.cast<String, dynamic>();
          if (result == null) {
            finish(null);
            return;
          }
          final Map<String, dynamic>? main =
              _pickMain((result['isolates'] as List<dynamic>?) ?? <dynamic>[]);
          finish(_Probe(main?['name'] as String?, result['name'] as String?));
        } catch (_) {
          finish(null);
        }
      },
      onError: (Object _) => finish(null),
      onDone: () => finish(null),
      cancelOnError: true,
    );
    ws.add(jsonEncode(<String, Object?>{'jsonrpc': '2.0', 'id': '1', 'method': 'getVM'}));
    return await completer.future.timeout(
      Duration(milliseconds: timeoutMs),
      onTimeout: () => null,
    );
  } catch (_) {
    return null;
  } finally {
    await sub?.cancel();
    await ws?.close();
  }
}

Future<String?> _resolveDdsHttpUrl(String vmServiceHttpUrl) async {
  HttpClient? client;
  try {
    client = HttpClient()..connectionTimeout = const Duration(milliseconds: 1200);
    final HttpClientRequest req = await client.getUrl(Uri.parse(vmServiceHttpUrl));
    req.followRedirects = false;
    final HttpClientResponse res = await req.close().timeout(const Duration(milliseconds: 1200));
    final String? loc = res.headers.value('location');
    if (loc == null) {
      return res.statusCode >= 200 && res.statusCode < 300 ? vmServiceHttpUrl : null;
    }
    final Uri locUrl = Uri.parse(loc).isAbsolute
        ? Uri.parse(loc)
        : Uri.parse(vmServiceHttpUrl).resolve(loc);
    final String? embedded = locUrl.queryParameters['uri'];
    if (embedded != null) {
      final Uri ws = Uri.parse(embedded);
      String path = ws.path.replaceAll(RegExp(r'/ws/?$'), '/');
      if (!path.endsWith('/')) path += '/';
      return '${ws.scheme == 'wss' ? 'https' : 'http'}://${ws.host}${ws.hasPort ? ':${ws.port}' : ''}$path';
    }
    final List<String> parts = locUrl.path.split('/').where((String s) => s.isNotEmpty).toList();
    final String auth = parts.isNotEmpty && parts.first.contains('=') ? parts.first : '';
    if (auth.isNotEmpty) {
      return toHttpUrl(locUrl.host, locUrl.hasPort ? locUrl.port : 0, auth);
    }
    return '${locUrl.scheme}://${locUrl.host}${locUrl.hasPort ? ':${locUrl.port}' : ''}/';
  } catch (_) {
    return null;
  } finally {
    client?.close(force: true);
  }
}

Future<List<_DdsHint>> _listDevelopmentServiceHints() async {
  final List<_DdsHint> hints = <_DdsHint>[];
  try {
    final List<FileSystemEntity> entries = await Directory('/proc').list().toList();
    for (final FileSystemEntity entry in entries) {
      final String pid = entry.uri.pathSegments.where((String s) => s.isNotEmpty).last;
      if (!RegExp(r'^\d+$').hasMatch(pid)) continue;
      List<String> args;
      try {
        final String raw =
            (await File('/proc/$pid/cmdline').readAsBytes()).toString();
        args = raw.split('\u0000').where((String a) => a.isNotEmpty).toList();
      } catch (_) {
        continue;
      }
      if (!args.any((String a) => a == 'development-service' || a.endsWith('development-service'))) {
        continue;
      }
      String vmUri = '';
      String appFlag = '';
      for (final String a in args) {
        if (a.startsWith('--vm-service-uri=')) {
          vmUri = a.substring('--vm-service-uri='.length);
        }
        if (a.startsWith('--app-name=')) {
          appFlag = a.substring('--app-name='.length);
        }
      }
      if (vmUri.isEmpty) continue;
      final Uri uri = Uri.parse(vmUri);
      if (!uri.hasPort) continue;
      final String? device = RegExp(r'Device:\s*([^-]+?)(?:\s+-|\$)')
          .firstMatch(appFlag)
          ?.group(1)
          ?.trim();
      final String? pkg =
          RegExp(r'Package:\s*(.+)\$').firstMatch(appFlag)?.group(1)?.trim();
      hints.add(_DdsHint(
        vmServiceHttpUrl: vmUri.endsWith('/') ? vmUri : '$vmUri/',
        vmPort: uri.port,
        authCode: uri.path.replaceAll(RegExp(r'^/+|/+$'), ''),
        appName: pkg?.replaceAll('_', '-') ?? (appFlag.isNotEmpty ? appFlag : null),
        deviceName: device,
      ));
    }
  } catch (_) {}
  return hints;
}

Future<List<DiscoveredApp>> _discoverViaDevelopmentService(
  Map<int, _AdbForward> adbForwards,
) async {
  final List<_DdsHint> hints = await _listDevelopmentServiceHints();
  final List<DiscoveredApp> apps = <DiscoveredApp>[];
  for (final _DdsHint hint in hints) {
    final String ddsHttp =
        (await _resolveDdsHttpUrl(hint.vmServiceHttpUrl)) ?? hint.vmServiceHttpUrl;
    final String wsUrl = toWsUrl(ddsHttp);
    int port = hint.vmPort;
    try {
      port = Uri.parse(ddsHttp).port;
    } catch (_) {}
    final _Probe? probe = await probeVmOverWs(wsUrl, 1200);
    final _AdbForward? adb = adbForwards[hint.vmPort];
    final List<String> nameParts = <String>[
      if (hint.appName != null) hint.appName!,
      if (hint.deviceName != null) hint.deviceName! else if (adb != null) adb.deviceName,
    ];
    apps.add(DiscoveredApp(
      id: _appId(wsUrl),
      name: nameParts.isEmpty ? 'Flutter :$port' : nameParts.join(' · '),
      wsUrl: wsUrl,
      httpUrl: ddsHttp,
      port: port,
      source: 'dds',
      isolateName: probe?.isolateName,
      connectable: probe != null,
      deviceName: hint.deviceName ?? adb?.deviceName,
      detail: probe != null
          ? 'Dart Development Service (from flutter run)'
          : 'DDS found but WebSocket probe failed',
    ));
  }
  return apps;
}

Future<List<DiscoveredApp>> _discoverViaMdns() async {
  final List<DiscoveredApp> apps = <DiscoveredApp>[];
  for (final String line in await _run(
      'avahi-browse', <String>['-rpt', '_dartVmService._tcp'], 2500)) {
    if (!line.startsWith('=')) continue;
    final List<String> parts = line.split(';');
    if (parts.length < 9) continue;
    final String serviceName = parts[3].isEmpty ? 'Flutter app' : parts[3];
    final String host = parts[7].isEmpty ? '127.0.0.1' : parts[7];
    final int? port = int.tryParse(parts[8]);
    if (port == null) continue;
    final String txt = parts.skip(9).join(';');
    final RegExpMatch? authMatch =
        RegExp(r'authCode=([^\s;"]+)').firstMatch(txt.replaceAll('"', '\n'));
    final String auth = authMatch?.group(1)?.trim() ?? '';
    final String httpUrl =
        toHttpUrl(host == '0.0.0.0' ? '127.0.0.1' : host, port, auth);
    final String wsUrl = toWsUrl(httpUrl);
    final _Probe? probe = await probeVmOverWs(wsUrl, 900);
    apps.add(DiscoveredApp(
      id: _appId(wsUrl),
      name: serviceName.replaceAll(RegExp(r'\._dartVmService\._tcp\.local$', caseSensitive: false), '').isEmpty
          ? 'Flutter :$port'
          : serviceName.replaceAll(RegExp(r'\._dartVmService\._tcp\.local$', caseSensitive: false), ''),
      wsUrl: wsUrl,
      httpUrl: httpUrl,
      port: port,
      source: 'mdns',
      isolateName: probe?.isolateName,
      connectable: probe != null,
      detail: probe != null ? 'Found via mDNS' : 'Found via mDNS (could not verify yet)',
    ));
  }
  return apps;
}

Future<List<DiscoveredApp>> _discoverServiceInfoFiles() async {
  final List<DiscoveredApp> apps = <DiscoveredApp>[];
  final List<String> files = <String>[];
  try {
    final List<FileSystemEntity> entries = await Directory('/tmp').list().toList();
    for (final FileSystemEntity entry in entries) {
      final String name = entry.uri.pathSegments.last.toLowerCase();
      if (name.contains('service') &&
          (name.contains('info') || name.contains('vm')) &&
          (name.endsWith('.json') || name.endsWith('.txt'))) {
        files.add(entry.path);
      }
      if (entry is Directory && name.startsWith('flutter_tools')) {
        try {
          final List<FileSystemEntity> nested = await entry.list().toList();
          for (final FileSystemEntity n in nested) {
            final String nn = n.uri.pathSegments.last;
            if (nn.endsWith('.json') && RegExp('service|vm', caseSensitive: false).hasMatch(nn)) {
              files.add(n.path);
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  for (final String file in files.take(40)) {
    try {
      final Map<String, dynamic> data =
          (jsonDecode(await File(file).readAsString()) as Map).cast<String, dynamic>();
      String? httpUrl = (data['uri'] ?? data['url']) as String?;
      if (httpUrl == null && data['port'] != null) {
        httpUrl = toHttpUrl(
          '127.0.0.1',
          (data['port'] as num).toInt(),
          '${data['authentication_code'] ?? data['authCode'] ?? ''}',
        );
      }
      if (httpUrl == null) continue;
      final String wsUrl = toWsUrl(httpUrl);
      final int port = Uri.parse(httpUrl).port;
      final _Probe? probe = await probeVmOverWs(wsUrl, 900);
      apps.add(DiscoveredApp(
        id: _appId(wsUrl),
        name: probe?.isolateName ?? 'VM service :$port',
        wsUrl: wsUrl,
        httpUrl: httpUrl,
        port: port,
        source: 'service-info',
        isolateName: probe?.isolateName,
        connectable: probe != null,
        detail: 'From $file',
      ));
    } catch (_) {}
  }
  return apps;
}

bool _looksLikeDevTools(String body, int status) {
  if (status != 200) return false;
  return RegExp('Flutter Authors', caseSensitive: false).hasMatch(body) ||
      RegExp('DevTools', caseSensitive: false).hasMatch(body);
}

Future<({int status, String body})?> _httpGet(String url, int timeoutMs) async {
  HttpClient? client;
  try {
    client = HttpClient()..connectionTimeout = Duration(milliseconds: timeoutMs);
    final HttpClientRequest req = await client.getUrl(Uri.parse(url));
    req.followRedirects = false;
    final HttpClientResponse res =
        await req.close().timeout(Duration(milliseconds: timeoutMs));
    final String body = await res
        .transform(utf8.decoder)
        .join()
        .timeout(Duration(milliseconds: timeoutMs));
    return (status: res.statusCode, body: body.substring(0, body.length > 4000 ? 4000 : body.length));
  } catch (_) {
    return null;
  } finally {
    client?.close(force: true);
  }
}

Future<DiscoveredApp?> _probePort(
  int port,
  _AdbForward? adb,
  List<_FlutterRunHint> flutterHints,
  Map<int, _DdsHint> ddsByPort,
) async {
  final _DdsHint? ddsHint = ddsByPort[port];
  if (ddsHint != null) {
    final String ddsHttp =
        (await _resolveDdsHttpUrl(ddsHint.vmServiceHttpUrl)) ?? ddsHint.vmServiceHttpUrl;
    final String wsUrl = toWsUrl(ddsHttp);
    int resolvedPort = port;
    try {
      resolvedPort = Uri.parse(ddsHttp).port;
    } catch (_) {}
    final _Probe? probe = await probeVmOverWs(wsUrl, 1200);
    final List<String> nameParts = <String>[
      if (ddsHint.appName != null) ddsHint.appName!,
      if (ddsHint.deviceName != null) ddsHint.deviceName! else if (adb != null) adb.deviceName,
    ];
    return DiscoveredApp(
      id: _appId(wsUrl),
      name: nameParts.isEmpty
          ? _displayNameForPort(
              port: resolvedPort,
              isolateName: probe?.isolateName,
              adb: adb,
              flutterHints: flutterHints,
              needsAuth: probe == null,
            )
          : nameParts.join(' · '),
      wsUrl: wsUrl,
      httpUrl: ddsHttp,
      port: resolvedPort,
      source: 'dds',
      isolateName: probe?.isolateName,
      connectable: probe != null,
      deviceName: ddsHint.deviceName ?? adb?.deviceName,
      detail: probe != null ? 'Dart Development Service (from flutter run)' : 'DDS found but WebSocket probe failed',
    );
  }

  final String plainWs = 'ws://127.0.0.1:$port/ws';
  final String httpUrl = 'http://127.0.0.1:$port/';
  final ({int status, String body})? res = await _httpGet(httpUrl, adb != null ? 900 : 350);
  if (res != null && _looksLikeDevTools(res.body, res.status)) return null;

  final bool looksDart = res != null &&
      (RegExp('Dart VM Service|Observatory|package:shelf', caseSensitive: false)
              .hasMatch(res.body) ||
          RegExp('missing or invalid authentication code', caseSensitive: false)
              .hasMatch(res.body));
  if (!looksDart && adb == null) return null;

  final bool needsAuth = res != null &&
      (RegExp('missing or invalid authentication code', caseSensitive: false)
              .hasMatch(res.body) ||
          res.status == 403);

  final _Probe? probe = (looksDart || adb != null)
      ? await probeVmOverWs(plainWs, adb != null ? 900 : 700)
      : null;
  final String name = _displayNameForPort(
    port: port,
    isolateName: probe?.isolateName,
    vmName: probe?.vmName,
    adb: adb,
    flutterHints: flutterHints,
    needsAuth: needsAuth && probe == null,
  );
  return DiscoveredApp(
    id: probe != null ? _appId(plainWs) : 'port-$port',
    name: name,
    wsUrl: plainWs,
    httpUrl: httpUrl,
    port: port,
    source: adb != null ? 'adb' : 'port-scan',
    isolateName: probe?.isolateName,
    connectable: probe != null,
    deviceName: adb?.deviceName,
    detail: adb != null
        ? (probe != null ? 'via ADB' : 'ADB forward — paste full VM Service URL from flutter run')
        : (probe != null ? 'Found by scanning localhost ports' : 'Detected Dart HTTP service (could not open VM WebSocket)'),
  );
}

int _sourceRank(String source) {
  switch (source) {
    case 'dds':
      return 0;
    case 'mdns':
      return 1;
    case 'service-info':
      return 2;
    case 'adb':
      return 3;
    default:
      return 4;
  }
}

int _scoreName(String name, DiscoveredApp app) {
  int score = 0;
  if (app.source == 'dds') score += 5;
  if (app.deviceName != null && name.contains(app.deviceName!)) score += 4;
  if (app.isolateName != null && name == app.isolateName) score += 3;
  if (!RegExp(r'^Dart (VM|service) :\d+$', caseSensitive: false).hasMatch(name)) score += 2;
  if (name.contains('·')) score += 1;
  return score;
}

/// Discovers local Dart/Flutter VM Service endpoints.
Future<List<DiscoveredApp>> discoverRunningApps() async {
  final Map<int, DiscoveredApp> byPort = <int, DiscoveredApp>{};
  final Map<int, _AdbForward> adbForwards = await _listAdbForwards();

  Future<List<DiscoveredApp>> guarded(Future<List<DiscoveredApp>> f, int ms) async {
    try {
      return await f.timeout(Duration(milliseconds: ms), onTimeout: () => <DiscoveredApp>[]);
    } catch (_) {
      return <DiscoveredApp>[];
    }
  }

  final List<List<DiscoveredApp>> settled = await Future.wait(<Future<List<DiscoveredApp>>>[
    guarded(_discoverViaDevelopmentService(adbForwards), 4000),
    guarded(_discoverViaMdns(), 3000),
    guarded(_discoverServiceInfoFiles(), 3000),
    guarded(_portScan(adbForwards), _discoverTimeoutMs),
  ]);

  void merge(List<DiscoveredApp> list) {
    for (final DiscoveredApp app in list) {
      final DiscoveredApp? prev = byPort[app.port];
      if (prev == null) {
        byPort[app.port] = app;
        continue;
      }
      final bool preferApp = (app.connectable && !prev.connectable) ||
          (app.connectable == prev.connectable &&
              _sourceRank(app.source) < _sourceRank(prev.source));
      byPort[app.port] = DiscoveredApp(
        id: preferApp ? app.id : (prev.connectable ? prev.id : app.id),
        name: _scoreName(app.name, app) >= _scoreName(prev.name, prev) ? app.name : prev.name,
        wsUrl: preferApp ? app.wsUrl : (prev.connectable ? prev.wsUrl : app.wsUrl),
        httpUrl: preferApp ? app.httpUrl : (prev.connectable ? prev.httpUrl : app.httpUrl),
        port: app.port,
        source: preferApp
            ? app.source
            : (_sourceRank(app.source) < _sourceRank(prev.source) ? app.source : prev.source),
        isolateName: app.isolateName ?? prev.isolateName,
        connectable: app.connectable || prev.connectable,
        deviceName: app.deviceName ?? prev.deviceName,
        detail: preferApp ? (app.detail ?? prev.detail) : (prev.detail ?? app.detail),
      );
    }
  }

  for (final List<DiscoveredApp> list in settled) {
    merge(list);
  }

  final Set<String> connectableKeys = byPort.values
      .where((DiscoveredApp a) => a.connectable)
      .map((DiscoveredApp a) => '${a.deviceName ?? ''}|${a.name.split(' · ').first}')
      .toSet();
  for (final MapEntry<int, DiscoveredApp> e in byPort.entries.toList()) {
    final DiscoveredApp app = e.value;
    if (app.connectable || app.source != 'adb') continue;
    if (connectableKeys.contains('${app.deviceName ?? ''}|${app.name.split(' · ').first}')) {
      byPort.remove(e.key);
    }
  }

  final List<DiscoveredApp> apps = byPort.values.toList();
  final Map<String, int> nameCounts = <String, int>{};
  for (final DiscoveredApp app in apps) {
    nameCounts[app.name] = (nameCounts[app.name] ?? 0) + 1;
  }
  for (int i = 0; i < apps.length; i++) {
    final DiscoveredApp app = apps[i];
    if ((nameCounts[app.name] ?? 0) > 1) {
      apps[i] = DiscoveredApp(
        id: app.id,
        name: '${app.name} · :${app.port}',
        wsUrl: app.wsUrl,
        httpUrl: app.httpUrl,
        port: app.port,
        source: app.source,
        isolateName: app.isolateName,
        connectable: app.connectable,
        deviceName: app.deviceName,
        detail: app.detail,
      );
    }
  }

  apps.sort((DiscoveredApp a, DiscoveredApp b) {
    if (a.connectable != b.connectable) return a.connectable ? -1 : 1;
    final int rank = _sourceRank(a.source) - _sourceRank(b.source);
    if (rank != 0) return rank;
    return a.port - b.port;
  });
  return apps;
}

Future<List<DiscoveredApp>> _portScan(Map<int, _AdbForward> adbForwards) async {
  final List<int> ports = await _listListeningPorts();
  final List<_FlutterRunHint> flutterHints = await _listFlutterRunHints();
  final List<_DdsHint> ddsHints = await _listDevelopmentServiceHints();
  final Map<int, _DdsHint> ddsByPort = <int, _DdsHint>{
    for (final _DdsHint h in ddsHints) h.vmPort: h,
  };

  final Set<int> candidates = <int>{};
  candidates.addAll(ports.where((int p) => p >= 1024).take(80));
  candidates.addAll(adbForwards.keys);
  candidates.addAll(ddsHints.map((_DdsHint h) => h.vmPort));

  final List<DiscoveredApp> apps = <DiscoveredApp>[];
  final List<int> list = candidates.toList();
  const int batchSize = 12;
  for (int i = 0; i < list.length; i += batchSize) {
    final List<int> slice = list.sublist(i, (i + batchSize).clamp(0, list.length));
    final List<DiscoveredApp?> results = await Future.wait(
      slice.map((int port) => _probePort(port, adbForwards[port], flutterHints, ddsByPort)),
    );
    for (final DiscoveredApp? r in results) {
      if (r != null) apps.add(r);
    }
  }
  return apps;
}
