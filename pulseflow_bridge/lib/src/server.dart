import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_web_socket/shelf_web_socket.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'session.dart';

/// HTTP + WebSocket server that speaks the PulseFlow bridge protocol.
///
/// `GET /` returns a health document; `/bridge` upgrades to the dashboard
/// WebSocket. The wire format matches the original Node bridge.
class PulseBridgeServer {
  PulseBridgeServer({this.host = '0.0.0.0', this.port = 3847});

  final String host;
  final int port;
  HttpServer? _server;

  int get boundPort => _server?.port ?? port;

  Future<Uri> start() async {
    final Handler handler = Cascade()
        .add(_healthHandler)
        .add(webSocketHandler(
          (WebSocketChannel channel, String? protocol) => _attach(channel),
          pingInterval: const Duration(seconds: 15),
        ))
        .handler;
    _server = await shelf_io.serve(handler, host, port);
    return Uri(scheme: 'http', host: host, port: _server!.port);
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<Response> _healthHandler(Request request) async {
    if (request.url.path.isNotEmpty) {
      return Response.notFound('');
    }
    return Response.ok(
      jsonEncode(<String, Object?>{'service': 'pulseflow-bridge', 'port': boundPort, 'ok': true}),
      headers: const <String, String>{'content-type': 'application/json'},
    );
  }

  void _attach(WebSocketChannel channel) {
    final BridgeSession session = BridgeSession((Map<String, Object?> payload) {
      try {
        channel.sink.add(jsonEncode(payload));
      } catch (_) {
        // Channel closed.
      }
    });
    channel.stream.listen(
      (dynamic data) {
        try {
          final Map<String, dynamic> msg =
              (jsonDecode('$data') as Map).cast<String, dynamic>();
          unawaited(session.handle(msg));
        } catch (_) {
          // Ignore malformed client messages.
        }
      },
      onDone: session.close,
      onError: (Object _) => session.close(),
      cancelOnError: true,
    );
  }
}
