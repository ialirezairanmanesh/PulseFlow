import 'package:flutter/foundation.dart';

/// One widget rebuilt during a frame, with a link to its nearest rebuilt
/// ancestor (`parentIndex`, or null when it is a rebuild root).
@immutable
class RebuildNode {
  const RebuildNode({
    required this.widgetId,
    required this.name,
    required this.route,
    this.parentIndex,
    this.sourceUri,
    this.sourceLine,
  });

  final String widgetId;
  final String name;
  final String route;
  final int? parentIndex;
  final String? sourceUri;
  final int? sourceLine;
}

/// A rebuild "root": a widget that rebuilt without any rebuilt ancestor.
@immutable
class RebuildCauseGroup {
  const RebuildCauseGroup({
    required this.rootId,
    required this.widget,
    required this.route,
    required this.cause,
    required this.rebuilds,
    required this.children,
    this.sourceUri,
    this.sourceLine,
  });

  final String rootId;
  final String widget;
  final String route;
  final String cause;
  final int rebuilds;
  final int children;
  final String? sourceUri;
  final int? sourceLine;
}

/// A widget attributed to a rebuild root.
@immutable
class AttributedRebuild {
  const AttributedRebuild({
    required this.widget,
    required this.root,
    required this.count,
  });

  final String widget;
  final String root;
  final int count;
}

@immutable
class RebuildCauseReport {
  const RebuildCauseReport({required this.roots, required this.attributed});

  final List<RebuildCauseGroup> roots;
  final List<AttributedRebuild> attributed;
}

/// Groups one frame's rebuilt widgets into roots and attributed descendants.
///
/// Pure and side-effect free so it can be unit-tested without a widget tree.
RebuildCauseReport groupRebuilds(List<RebuildNode> nodes) {
  if (nodes.isEmpty) {
    return const RebuildCauseReport(
      roots: <RebuildCauseGroup>[],
      attributed: <AttributedRebuild>[],
    );
  }

  int rootIndex(int start) {
    var current = start;
    final Set<int> seen = <int>{};
    while (true) {
      final int? parent = nodes[current].parentIndex;
      if (parent == null || parent < 0 || parent >= nodes.length || seen.contains(parent)) {
        break;
      }
      seen.add(current);
      current = parent;
    }
    return current;
  }

  final Map<int, List<int>> byRoot = <int, List<int>>{};
  for (var i = 0; i < nodes.length; i++) {
    byRoot.putIfAbsent(rootIndex(i), () => <int>[]).add(i);
  }

  final List<RebuildCauseGroup> roots = <RebuildCauseGroup>[];
  final List<AttributedRebuild> attributed = <AttributedRebuild>[];

  byRoot.forEach((int rootIdx, List<int> members) {
    final RebuildNode rootNode = nodes[rootIdx];
    final Set<String> childNames = <String>{};
    final Map<String, int> counts = <String, int>{};
    for (final int i in members) {
      if (i == rootIdx) continue;
      childNames.add(nodes[i].name);
      counts[nodes[i].name] = (counts[nodes[i].name] ?? 0) + 1;
    }
    roots.add(
      RebuildCauseGroup(
        rootId: rootNode.widgetId,
        widget: rootNode.name,
        route: rootNode.route,
        cause: 'self',
        rebuilds: members.length,
        children: childNames.length,
        sourceUri: rootNode.sourceUri,
        sourceLine: rootNode.sourceLine,
      ),
    );
    counts.forEach((String widget, int count) {
      attributed.add(
        AttributedRebuild(widget: widget, root: rootNode.name, count: count),
      );
    });
  });

  roots.sort((RebuildCauseGroup a, RebuildCauseGroup b) => b.rebuilds.compareTo(a.rebuilds));
  attributed.sort((AttributedRebuild a, AttributedRebuild b) => b.count.compareTo(a.count));
  return RebuildCauseReport(roots: roots, attributed: attributed);
}
