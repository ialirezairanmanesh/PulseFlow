#!/usr/bin/env bash
# Start PulseFlow (Next.js UI + WebSocket bridge).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

WEB_PORT="${PULSEFLOW_WEB_PORT:-3846}"
BRIDGE_PORT="${PULSEFLOW_BRIDGE_PORT:-3847}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (18+)." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi

free_port() {
  local port="$1"
  local pids
  pids="$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  if [[ -n "${pids:-}" ]]; then
    echo "Freeing port $port (pids: $pids)…"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
  fi
}

free_port "$WEB_PORT"
free_port "$BRIDGE_PORT"

echo
echo "  PulseFlow"
echo "  UI:     http://127.0.0.1:${WEB_PORT}"
echo "  Bridge: http://127.0.0.1:${BRIDGE_PORT}  (ws://127.0.0.1:${BRIDGE_PORT}/bridge)"
echo
echo "  Ctrl+C to stop."
echo

exec npm run dev
