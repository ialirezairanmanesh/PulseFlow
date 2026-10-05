import 'dart:convert';

import 'package:pulseflow_bridge/src/discover.dart';

Future<void> main() async {
  final List<DiscoveredApp> apps = await discoverRunningApps();
  print(const JsonEncoder.withIndent('  ').convert(apps.map((a) => a.toJson()).toList()));
}
