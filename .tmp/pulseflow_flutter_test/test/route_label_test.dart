import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

class InvoicePage extends StatelessWidget {
  const InvoicePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: AnimatedBuilderProbe());
  }
}

class AnimatedBuilderProbe extends StatelessWidget {
  const AnimatedBuilderProbe({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: const AlwaysStoppedAnimation<double>(0),
      builder: (BuildContext context, Widget? child) {
        // Expose this element to the test via a GlobalKey on a child.
        return const Text('probe');
      },
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('isUsefulScreenName accepts Page/Screen suffixes', () {
    expect(isUsefulScreenName('InvoicePage'), isTrue);
    expect(isUsefulScreenName('HomeScreen'), isTrue);
    expect(isUsefulScreenName('AnimatedBuilder'), isFalse);
    expect(isUsefulScreenName('Scaffold'), isFalse);
    expect(isUsefulScreenName('_PrivatePage'), isFalse);
  });

  testWidgets('uses ModalRoute.settings.name when present', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) {
            return TextButton(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    settings: const RouteSettings(name: '/invoices'),
                    builder: (_) => const InvoicePage(),
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

    final Element text = tester.element(find.text('probe'));
    expect(resolveRouteLabel(text), '/invoices');
  });

  testWidgets('falls back to nearest *Page ancestor when route is unnamed', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: InvoicePage(),
      ),
    );
    await tester.pumpAndSettle();

    final Element text = tester.element(find.text('probe'));
    expect(resolveRouteLabel(text), 'InvoicePage');
  });

  testWidgets('uses Router URI path for MaterialApp.router', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp.router(
        routerDelegate: _FixedRouterDelegate(
          child: const InvoicePage(),
          path: '/reports',
        ),
        routeInformationParser: _PathParser(),
        routeInformationProvider: PlatformRouteInformationProvider(
          initialRouteInformation: RouteInformation(uri: Uri.parse('/reports')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Element text = tester.element(find.text('probe'));
    expect(resolveRouteLabel(text), '/reports');
  });

  testWidgets('detectLiveRoute reads the current modal route', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) {
            return TextButton(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    settings: const RouteSettings(name: '/invoices'),
                    builder: (_) => const InvoicePage(),
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

    expect(detectLiveRoute(), '/invoices');
  });
}

class _PathParser extends RouteInformationParser<String> {
  @override
  Future<String> parseRouteInformation(RouteInformation routeInformation) async {
    final String path = routeInformation.uri.path;
    return path.isEmpty ? '/' : path;
  }

  @override
  RouteInformation restoreRouteInformation(String configuration) {
    return RouteInformation(uri: Uri.parse(configuration));
  }
}

class _FixedRouterDelegate extends RouterDelegate<String>
    with ChangeNotifier, PopNavigatorRouterDelegateMixin<String> {
  _FixedRouterDelegate({required this.child, required this.path});

  final Widget child;
  final String path;

  @override
  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  @override
  String? get currentConfiguration => path;

  @override
  Widget build(BuildContext context) {
    return Navigator(
      key: navigatorKey,
      pages: <Page<void>>[
        MaterialPage<void>(name: path, child: child),
      ],
      onDidRemovePage: (Page<Object?> page) {},
    );
  }

  @override
  Future<void> setNewRoutePath(String configuration) async {}
}
