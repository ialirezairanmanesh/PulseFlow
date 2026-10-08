#!/usr/bin/env bash
# Wrapper that skips Flutter's non-writable engine.stamp update in this sandbox.
set -euo pipefail
FLUTTER_ROOT="${FLUTTER_ROOT:-/home/alireza/flutter/flutter}"
CACHE="$FLUTTER_ROOT/bin/cache"
# Ensure stamp/realm exist without rewriting them when the cache is read-only.
if [[ ! -f "$CACHE/engine.stamp" ]]; then
  echo "missing engine.stamp" >&2
  exit 1
fi
# Call the real flutter entrypoint but replace update_engine_version.sh with a no-op
# by putting a fake bin/internal ahead on PATH? Easier: invoke dart flutter_tools directly.
DART="$CACHE/dart-sdk/bin/dart"
SNAPSHOT="$CACHE/flutter_tools.snapshot"
if [[ ! -f "$SNAPSHOT" ]]; then
  echo "missing flutter_tools.snapshot" >&2
  exit 1
fi
export FLUTTER_ROOT
exec "$DART" --disable-dart-dev "$SNAPSHOT" "$@"
