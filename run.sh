#!/usr/bin/env bash
#
# PulseFlow — start the Next.js dashboard and the Dart bridge together.
#
# Usage:
#   ./run.sh
#
# Env:
#   PULSEFLOW_WEB_PORT     dashboard port   (default 3846)
#   PULSEFLOW_BRIDGE_PORT  bridge port      (default 3847)
#   PULSEFLOW_MIRROR_PORT  device mirror    (default 3848)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASH="$ROOT/docs/pulseflow"
BRIDGE="$ROOT/pulseflow_bridge"

WEB_PORT="${PULSEFLOW_WEB_PORT:-3846}"
BRIDGE_PORT="${PULSEFLOW_BRIDGE_PORT:-3847}"
MIRROR_PORT="${PULSEFLOW_MIRROR_PORT:-3848}"

for tool in node npm dart; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "PulseFlow needs '$tool' but it was not found in PATH." >&2
    exit 1
  fi
done

free_port() {
  local port="$1"
  local pids=""
  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print}' \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  fi
  if [[ -n "${pids:-}" ]]; then
    echo "  freeing port $port (pids: $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
  fi
}

free_port "$WEB_PORT"
free_port "$BRIDGE_PORT"
free_port "$MIRROR_PORT"

if [[ ! -x "$DASH/node_modules/.bin/concurrently" ]]; then
  echo "  installing dashboard dependencies (npm install)…"
  (cd "$DASH" && npm install)
fi

if [[ ! -f "$BRIDGE/.dart_tool/package_config.json" ]]; then
  echo "  resolving bridge dependencies (dart pub get)…"
  (cd "$BRIDGE" && dart pub get)
fi

# Best-effort: build ws-scrcpy so the left device pane can stream.
if [[ ! -f "$DASH/device-mirror/ws-scrcpy/dist/index.js" ]]; then
  echo "  preparing device mirror (ws-scrcpy)…"
  "$DASH/device-mirror/setup.sh" || echo "  (device mirror setup skipped — pane will show offline until setup succeeds)"
fi

echo
echo "  PulseFlow"
echo "  UI:      http://127.0.0.1:${WEB_PORT}"
echo "  Bridge:  http://127.0.0.1:${BRIDGE_PORT}   (ws://127.0.0.1:${BRIDGE_PORT}/bridge)"
echo "  Mirror:  http://127.0.0.1:${MIRROR_PORT}   (live Android / redroid)"
echo
echo "  Ctrl+C to stop."
echo

cd "$DASH"
export PULSEFLOW_MIRROR_PORT="$MIRROR_PORT"
export NEXT_PUBLIC_MIRROR_PORT="$MIRROR_PORT"
exec npm run dev
