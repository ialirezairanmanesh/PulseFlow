import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/src/probes/rebuild_probe.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    RebuildProbe.instance.stop();
  });

  testWidgets('snapshot includes the mounted tree for the current route', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) {
            return TextButton(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    settings: const RouteSettings(name: '/tree'),
                    builder: (_) => const Scaffold(
                      body: Center(child: Text('leaf')),
                    ),
                  ),
                );
              },
              child: const Text('go'),
            );
          },
        ),
      ),
    );
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();

    RebuildProbe.instance.start();
    final Map<String, Object?> snap = RebuildProbe.instance.snapshot(limit: 200);
    final List<Object?> tree = snap['tree']! as List<Object?>;

    expect(snap['currentRoute'], '/tree');
    expect(tree, isNotEmpty);
    expect(
      tree.any((Object? n) {
        final Map<Object?, Object?> m = n! as Map<Object?, Object?>;
        return m['name'] == 'Text' && m['inTree'] == true;
      }),
      isTrue,
    );
    // Primary widgets list is the mounted tree when present.
    expect((snap['widgets']! as List<Object?>).length, tree.length);
  });
}
