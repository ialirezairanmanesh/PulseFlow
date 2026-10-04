import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  registerPulseFlow(appPackage: 'pulseflow_flutter_example');
  runApp(const PulseFlowExampleApp());
}

class PulseFlowExampleApp extends StatelessWidget {
  const PulseFlowExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PulseFlow example',
      navigatorObservers: <NavigatorObserver>[PulseFlowRouteObserver()],
      home: const HomeScreen(),
    );
  }
}

/// Reports route names so rebuilds can be grouped per screen.
class PulseFlowRouteObserver extends NavigatorObserver {
  final ValueNotifier<String?> currentRoute = ValueNotifier<String?>('home');

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    currentRoute.value = route.settings.name ?? currentRoute.value;
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    currentRoute.value = previousRoute?.settings.name ?? currentRoute.value;
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final List<String> _items = <String>['alpha', 'beta', 'gamma'];
  int _hits = 0;

  Future<void> _hitNetwork() async {
    try {
      final HttpClient client = HttpClient();
      final HttpClientRequest request =
          await client.getUrl(Uri.parse('https://example.com/'));
      final HttpClientResponse response = await request.close();
      await response.drain<void>();
      client.close();
    } catch (_) {
      // Offline is fine — the request is still captured.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PulseFlow example')),
      body: Column(
        children: <Widget>[
          // This widget rebuilds on every tap and will rank in Problems.
          _HitCounter(hits: _hits),
          Expanded(
            child: ListView.builder(
              itemCount: _items.length,
              itemBuilder: (BuildContext context, int index) {
                return ListTile(
                  title: Text(_items[index]),
                  subtitle: Text('Row $index'),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: <Widget>[
                FilledButton(
                  onPressed: () => setState(() => _hits += 1),
                  child: const Text('Rebuild'),
                ),
                FilledButton.tonal(
                  onPressed: () {
                    final Map<String, dynamic> invoice = jsonDecode(
                      '{"id":"INV-1","total":42}',
                    ) as Map<String, dynamic>;
                    setState(() => _items.add(invoice['id'] as String));
                  },
                  child: const Text('Add row'),
                ),
                FilledButton.tonal(
                  onPressed: _hitNetwork,
                  child: const Text('HTTP'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HitCounter extends StatelessWidget {
  const _HitCounter({required this.hits});

  final int hits;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Text('Hits: $hits', style: Theme.of(context).textTheme.headlineSmall),
    );
  }
}
