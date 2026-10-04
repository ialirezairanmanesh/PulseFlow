import 'dart:io';

import 'package:args/args.dart';
import 'package:pulseflow_bridge/pulseflow_bridge.dart';

Future<void> main(List<String> argv) async {
  final ArgParser parser = ArgParser()
    ..addOption(
      'port',
      abbr: 'p',
      defaultsTo: Platform.environment['PULSEFLOW_BRIDGE_PORT'] ?? '3847',
      help: 'Port to listen on.',
    )
    ..addOption('host', defaultsTo: '0.0.0.0', help: 'Interface to bind.');

  final ArgResults args = parser.parse(argv);
  final int port = int.tryParse('${args['port']}') ?? 3847;
  final PulseBridgeServer server =
      PulseBridgeServer(host: '${args['host']}', port: port);
  final Uri uri = await server.start();
  stdout.writeln('PulseFlow bridge listening on $uri (ws path /bridge)');
}
