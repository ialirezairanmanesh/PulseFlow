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

  test('reset clears the freeze flag so recording resumes', () {
    final RebuildProbe probe = RebuildProbe.instance;
    probe.start();
    probe.setFrozen(true);
    expect(probe.frozen, isTrue);

    probe.reset();

    expect(probe.active, isTrue, reason: 'reset must not stop the probe');
    expect(probe.frozen, isFalse, reason: 'a frozen probe looks dead after Record');
    probe.stop();
  });

  WidgetEntry? findEntry(String name) {
    for (final WidgetEntry e in RebuildProbe.instance.entries.values) {
      if (e.name == name || e.name.startsWith('$name<')) return e;
    }
    return null;
  }

  testWidgets('flags a builder that reuses its child', (WidgetTester tester) async {
    final ValueNotifier<int> notifier = ValueNotifier<int>(0);
    addTearDown(notifier.dispose);

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: ValueListenableBuilder<int>(
          valueListenable: notifier,
          child: const SizedBox(width: 1, height: 1),
          builder: (BuildContext context, int value, Widget? child) {
            return Stack(
              textDirection: TextDirection.ltr,
              children: <Widget>[
                child!,
                Text('$value', textDirection: TextDirection.ltr),
              ],
            );
          },
        ),
      ),
    );

    RebuildProbe.instance.start();
    notifier.value = 1;
    await tester.pump();

    final WidgetEntry? entry = findEntry('ValueListenableBuilder');
    expect(entry, isNotNull, reason: 'the builder did not rebuild under the probe');
    expect(entry!.childProvided, isTrue);
    expect(entry.childReused, isTrue);
  });

  testWidgets('flags a builder that ignores its child', (WidgetTester tester) async {
    final ValueNotifier<int> notifier = ValueNotifier<int>(0);
    addTearDown(notifier.dispose);

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: ValueListenableBuilder<int>(
          valueListenable: notifier,
          child: const SizedBox(width: 1, height: 1),
          builder: (BuildContext context, int value, Widget? child) =>
              Text('$value', textDirection: TextDirection.ltr),
        ),
      ),
    );

    RebuildProbe.instance.start();
    notifier.value = 1;
    await tester.pump();

    final WidgetEntry? entry = findEntry('ValueListenableBuilder');
    expect(entry, isNotNull, reason: 'the builder did not rebuild under the probe');
    expect(entry!.childProvided, isTrue);
    expect(entry.childReused, isFalse);
  });
}
