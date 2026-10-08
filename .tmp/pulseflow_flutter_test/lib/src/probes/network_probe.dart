import 'dart:async';
import 'dart:collection';
import 'dart:io';

/// One captured HTTP exchange.
class NetworkSample {
  NetworkSample({
    required this.id,
    required this.method,
    required this.uri,
    required this.latencyMs,
    required this.requestBytes,
    required this.responseBytes,
    this.status,
    this.error,
  });

  final String id;
  final String method;
  final String uri;
  final double latencyMs;
  final int requestBytes;
  final int responseBytes;
  final int? status;
  final String? error;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        't': DateTime.now().millisecondsSinceEpoch,
        'method': method,
        'uri': uri,
        'latencyMs': latencyMs,
        'requestBytes': requestBytes,
        'responseBytes': responseBytes,
        if (status != null) 'status': status,
        if (error != null) 'error': error,
      };
}

/// Captures HTTP requests made through `dart:io` [HttpClient] by installing a
/// delegating [HttpOverrides].
///
/// Covers anything built on top of `HttpClient` — including `package:http` and
/// Dio's IO adapter — without needing the VM Service HTTP profiler.
class NetworkProbe {
  NetworkProbe._();

  static final NetworkProbe instance = NetworkProbe._();

  final Queue<NetworkSample> _buffer = Queue<NetworkSample>();
  HttpOverrides? _previous;
  bool _installed = false;
  int _seq = 0;

  bool get installed => _installed;

  void install() {
    if (_installed) return;
    _installed = true;
    _previous = HttpOverrides.current;
    HttpOverrides.global = _PulseFlowHttpOverrides(_previous, this);
  }

  /// Returns buffered samples and clears the buffer.
  List<Map<String, Object?>> drain({int limit = 200}) {
    final List<NetworkSample> samples = _buffer.toList();
    _buffer.clear();
    final List<NetworkSample> recent =
        samples.length <= limit ? samples : samples.sublist(samples.length - limit);
    return recent.map((NetworkSample s) => s.toJson()).toList();
  }

  void reset() {
    _buffer.clear();
    _seq = 0;
  }

  void record({
    required String method,
    required Uri uri,
    required DateTime startedAt,
    required DateTime endedAt,
    int? status,
    int requestBytes = 0,
    int responseBytes = 0,
    String? error,
  }) {
    final double latencyMs =
        endedAt.difference(startedAt).inMicroseconds / 1000.0;
    _buffer.addLast(
      NetworkSample(
        id: 'http-${++_seq}',
        method: method,
        uri: redactUri(uri),
        latencyMs: double.parse(latencyMs.toStringAsFixed(1)),
        requestBytes: requestBytes < 0 ? 0 : requestBytes,
        responseBytes: responseBytes < 0 ? 0 : responseBytes,
        status: status,
        error: error,
      ),
    );
    while (_buffer.length > 500) {
      _buffer.removeFirst();
    }
  }
}

/// Query / user-info keys whose values are replaced with `***` in captured URIs.
const Set<String> kRedactedUriKeys = <String>{
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'auth',
  'authorization',
  'api_key',
  'apikey',
  'key',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'session',
  'sessionid',
  'sid',
};

/// Returns [uri] as a string with sensitive query params and user-info redacted.
String redactUri(Uri uri) {
  Uri cleaned = uri;
  if (uri.userInfo.isNotEmpty) {
    cleaned = uri.replace(userInfo: '***');
  }
  if (cleaned.queryParameters.isEmpty) return cleaned.toString();
  final Map<String, String> params = Map<String, String>.of(
    cleaned.queryParameters,
  );
  var changed = false;
  for (final String key in params.keys.toList()) {
    if (kRedactedUriKeys.contains(key.toLowerCase())) {
      params[key] = '***';
      changed = true;
    }
  }
  if (!changed) return cleaned.toString();
  return cleaned.replace(queryParameters: params).toString();
}

class _PulseFlowHttpOverrides extends HttpOverrides {
  _PulseFlowHttpOverrides(this._previous, this._probe);

  final HttpOverrides? _previous;
  final NetworkProbe _probe;

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final HttpClient inner =
        _previous?.createHttpClient(context) ??
        super.createHttpClient(context);
    return _TrackingHttpClient(inner, _probe);
  }
}

class _TrackingHttpClient implements HttpClient {
  _TrackingHttpClient(this._inner, this._probe);

  final HttpClient _inner;
  final NetworkProbe _probe;

  void _track(Future<HttpClientRequest> future, String method, Uri uri) {
    final DateTime startedAt = DateTime.now();
    unawaited(
      future.then<void>((HttpClientRequest request) {
        unawaited(
          request.done.then<void>((HttpClientResponse response) {
            _probe.record(
              method: method,
              uri: uri,
              startedAt: startedAt,
              endedAt: DateTime.now(),
              status: response.statusCode,
              requestBytes: request.contentLength,
              responseBytes: response.contentLength,
            );
          }).catchError((Object error) {
            _probe.record(
              method: method,
              uri: uri,
              startedAt: startedAt,
              endedAt: DateTime.now(),
              error: error.toString(),
            );
          }),
        );
      }).catchError((Object error) {
        _probe.record(
          method: method,
          uri: uri,
          startedAt: startedAt,
          endedAt: DateTime.now(),
          error: error.toString(),
        );
      }),
    );
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) {
    final Future<HttpClientRequest> future = _inner.openUrl(method, url);
    _track(future, method, url);
    return future;
  }

  @override
  Future<HttpClientRequest> open(
    String method,
    String host,
    int port,
    String path,
  ) =>
      openUrl(method, Uri(scheme: 'http', host: host, port: port, path: path));

  @override
  Future<HttpClientRequest> get(String host, int port, String path) =>
      open('GET', host, port, path);

  @override
  Future<HttpClientRequest> getUrl(Uri url) => openUrl('GET', url);

  @override
  Future<HttpClientRequest> post(String host, int port, String path) =>
      open('POST', host, port, path);

  @override
  Future<HttpClientRequest> postUrl(Uri url) => openUrl('POST', url);

  @override
  Future<HttpClientRequest> put(String host, int port, String path) =>
      open('PUT', host, port, path);

  @override
  Future<HttpClientRequest> putUrl(Uri url) => openUrl('PUT', url);

  @override
  Future<HttpClientRequest> delete(String host, int port, String path) =>
      open('DELETE', host, port, path);

  @override
  Future<HttpClientRequest> deleteUrl(Uri url) => openUrl('DELETE', url);

  @override
  Future<HttpClientRequest> patch(String host, int port, String path) =>
      open('PATCH', host, port, path);

  @override
  Future<HttpClientRequest> patchUrl(Uri url) => openUrl('PATCH', url);

  @override
  Future<HttpClientRequest> head(String host, int port, String path) =>
      open('HEAD', host, port, path);

  @override
  Future<HttpClientRequest> headUrl(Uri url) => openUrl('HEAD', url);

  @override
  Duration get idleTimeout => _inner.idleTimeout;
  @override
  set idleTimeout(Duration value) => _inner.idleTimeout = value;

  @override
  Duration? get connectionTimeout => _inner.connectionTimeout;
  @override
  set connectionTimeout(Duration? value) => _inner.connectionTimeout = value;

  @override
  int? get maxConnectionsPerHost => _inner.maxConnectionsPerHost;
  @override
  set maxConnectionsPerHost(int? value) => _inner.maxConnectionsPerHost = value;

  @override
  bool get autoUncompress => _inner.autoUncompress;
  @override
  set autoUncompress(bool value) => _inner.autoUncompress = value;

  @override
  String? get userAgent => _inner.userAgent;
  @override
  set userAgent(String? value) => _inner.userAgent = value;

  @override
  set authenticate(
    Future<bool> Function(Uri url, String scheme, String? realm)? f,
  ) =>
      _inner.authenticate = f;

  @override
  set connectionFactory(
    Future<ConnectionTask<Socket>> Function(
      Uri url,
      String? proxyHost,
      int? proxyPort,
    )?
    f,
  ) =>
      _inner.connectionFactory = f;

  @override
  set findProxy(String Function(Uri url)? f) => _inner.findProxy = f;

  @override
  set authenticateProxy(
    Future<bool> Function(String host, int port, String scheme, String? realm)?
    f,
  ) =>
      _inner.authenticateProxy = f;

  @override
  set badCertificateCallback(
    bool Function(X509Certificate cert, String host, int port)? callback,
  ) =>
      _inner.badCertificateCallback = callback;

  @override
  set keyLog(Function(String line)? callback) => _inner.keyLog = callback;

  @override
  void addCredentials(
    Uri url,
    String realm,
    HttpClientCredentials credentials,
  ) =>
      _inner.addCredentials(url, realm, credentials);

  @override
  void addProxyCredentials(
    String host,
    int port,
    String realm,
    HttpClientCredentials credentials,
  ) =>
      _inner.addProxyCredentials(host, port, realm, credentials);

  @override
  void close({bool force = false}) => _inner.close(force: force);
}
