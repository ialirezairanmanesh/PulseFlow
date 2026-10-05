import 'package:flutter_test/flutter_test.dart';
import 'package:pulseflow_flutter/pulseflow_flutter.dart';

void main() {
  test('groups a rebuilt subtree under its root', () {
    final RebuildCauseReport report = groupRebuilds(<RebuildNode>[
      const RebuildNode(widgetId: 'r|InvoiceListState|', name: 'InvoiceListState', route: '/invoices'),
      const RebuildNode(widgetId: 'r|InvoiceCard|', name: 'InvoiceCard', route: '/invoices', parentIndex: 0),
      const RebuildNode(widgetId: 'r|InvoiceCard|', name: 'InvoiceCard', route: '/invoices', parentIndex: 0),
    ]);

    expect(report.roots, hasLength(1));
    expect(report.roots.first.widget, 'InvoiceListState');
    expect(report.roots.first.rebuilds, 3);
    expect(report.roots.first.children, 1);

    final AttributedRebuild card =
        report.attributed.firstWhere((AttributedRebuild a) => a.widget == 'InvoiceCard');
    expect(card.count, 2);
    expect(card.root, 'InvoiceListState');
  });

  test('a widget with no rebuilt ancestor is its own root', () {
    final RebuildCauseReport report = groupRebuilds(<RebuildNode>[
      const RebuildNode(widgetId: 'a', name: 'A', route: '/r'),
      const RebuildNode(widgetId: 'b', name: 'B', route: '/r'),
    ]);
    expect(report.roots, hasLength(2));
    expect(report.roots.every((RebuildCauseGroup g) => g.cause == 'self'), isTrue);
  });

  test('follows a deep chain to the top root', () {
    final RebuildCauseReport report = groupRebuilds(<RebuildNode>[
      const RebuildNode(widgetId: 'root', name: 'Root', route: '/r'),
      const RebuildNode(widgetId: 'mid', name: 'Mid', route: '/r', parentIndex: 0),
      const RebuildNode(widgetId: 'leaf', name: 'Leaf', route: '/r', parentIndex: 1),
    ]);
    expect(report.roots, hasLength(1));
    expect(report.roots.first.widget, 'Root');
    final AttributedRebuild leaf =
        report.attributed.firstWhere((AttributedRebuild a) => a.widget == 'Leaf');
    expect(leaf.root, 'Root');
  });

  test('empty input yields an empty report', () {
    final RebuildCauseReport report = groupRebuilds(const <RebuildNode>[]);
    expect(report.roots, isEmpty);
    expect(report.attributed, isEmpty);
  });
}
