/**
 * Heuristic + allowlist for Flutter / Material / third-party noise widgets.
 * Probe payloads set `isFramework` when they can; this keeps the dashboard
 * accurate even when the probe list is stale or incomplete.
 */

const FRAMEWORK_EXACT = new Set([
  "Text",
  "RichText",
  "Padding",
  "Container",
  "SizedBox",
  "Column",
  "Row",
  "Flex",
  "Stack",
  "Positioned",
  "Align",
  "Center",
  "Expanded",
  "Flexible",
  "Listener",
  "Semantics",
  "KeyedSubtree",
  "RepaintBoundary",
  "InheritedWidget",
  "InheritedModel",
  "Builder",
  "LayoutBuilder",
  "MediaQuery",
  "Directionality",
  "DefaultTextStyle",
  "DefaultSelectionStyle",
  "IconTheme",
  "Theme",
  "Material",
  "Scaffold",
  "GestureDetector",
  "MouseRegion",
  "Focus",
  "FocusScope",
  "FocusTraversalGroup",
  "Overlay",
  "OverlayEntry",
  "TickerMode",
  "IgnorePointer",
  "AbsorbPointer",
  "Opacity",
  "Transform",
  "ClipRect",
  "ClipRRect",
  "DecoratedBox",
  "ConstrainedBox",
  "UnconstrainedBox",
  "LimitedBox",
  "OverflowBox",
  "SizedOverflowBox",
  "FractionallySizedBox",
  "AspectRatio",
  "IntrinsicHeight",
  "IntrinsicWidth",
  "Offstage",
  "Visibility",
  "IndexedStack",
  "Wrap",
  "Flow",
  "CustomMultiChildLayout",
  "SingleChildScrollView",
  "CustomScrollView",
  "NotificationListener",
  "ScrollConfiguration",
  "Scrollable",
  "RawGestureDetector",
  "Actions",
  "Shortcuts",
  "Localizations",
  "Title",
  "Banner",
  "CheckedModeBanner",
  "InkWell",
  "InkResponse",
  "SelectionArea",
  "SelectableRegion",
  "AnimatedBuilder",
  "AnimatedContainer",
  "AnimatedOpacity",
  "AnimatedPadding",
  "AnimatedPositioned",
  "AnimatedAlign",
  "AnimatedSize",
  "AnimatedSwitcher",
  "AnimatedDefaultTextStyle",
  "AnimatedPhysicalModel",
  "AnimatedTheme",
  "AnimatedCrossFade",
  "ListenableBuilder",
  "ValueListenableBuilder",
  "FadeTransition",
  "ScaleTransition",
  "SizeTransition",
  "SlideTransition",
  "RotationTransition",
  "DecoratedBoxTransition",
  "RelativePositionedTransition",
  // Common third-party shells that dominate ranks without being the app root.
  "SvgPicture",
  "VectorGraphic",
]);

/** Private Flutter elements and known Material/focus/ink/scroll shells. */
const FRAMEWORK_PREFIXES = [
  "_Focus",
  "_Actions",
  "_Shortcuts",
  "_Ink",
  "_ParentInk",
  "_Selectable",
  "_Scrollable",
  "_Selection",
  "_Overlay",
  "_Theater",
  "_Inherited",
  "_EffectiveTicker",
  "_Scribble",
];

export function isFrameworkWidgetName(name: string | undefined | null): boolean {
  if (!name) return false;
  if (FRAMEWORK_EXACT.has(name)) return true;
  // Flutter private Element/RenderObject wrappers (e.g. _FocusInheritedScope).
  if (name.startsWith("_")) return true;
  // Implicitly-animated / transition shells from the framework.
  if (/^Animated[A-Z]/.test(name)) return true;
  if (/Transition$/.test(name)) return true;
  return FRAMEWORK_PREFIXES.some((p) => name.startsWith(p));
}

export function isFrameworkWidget(w: {
  name: string;
  isFramework?: boolean;
}): boolean {
  return Boolean(w.isFramework) || isFrameworkWidgetName(w.name);
}
