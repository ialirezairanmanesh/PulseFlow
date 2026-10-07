#!/usr/bin/env bash
#
# redroid.sh — manage redroid (Android-in-Docker) containers for PulseFlow testing.
#
# Each instance is a named container with its own ADB port so you can run
# multiple modes (debug/profile/release) side-by-side, and PulseFlow's
# discovery will find them via ADB automatically.
#
# Usage:
#   ./redroid.sh start <name> [android-version]   e.g. start debug 14.0.0-latest
#   ./redroid.sh stop  <name>|all
#   ./redroid.sh list
#   ./redroid.sh connect                         connect ADB to all instances
#   ./redroid.sh run <name> <mode> <app-dir>     e.g. run debug ../pulseflow_flutter/example
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULSEFLOW_FLUTTER="${PULSEFLOW_FLUTTER:-$ROOT/../pulseflow_flutter}"
FLUTTER_BIN="${FLUTTER_BIN:-/home/alireza/flutter/flutter/bin/flutter}"
ADB_BIN="${ADB_BIN:-adb}"

# name -> adb host port
declare -A ADB_PORTS=(
  ["debug"]=5555
  ["profile"]=5565
  ["release"]=5575
)

container_name() {
  echo "redroid-$1"
}

start() {
  local name="$1"
  local version="${2:-14.0.0-latest}"
  local port="${ADB_PORTS[$name]:-5575}"
  local cname
  cname="$(container_name "$name")"

  if docker ps -a --format '{{.Names}}' | grep -q "^${cname}$"; then
    echo "  [$cname] already exists (stopped). Starting..."
    docker start "$cname" 2>/dev/null || true
  else
    echo "  [$cname] pulling redroid:${version}..."
    docker pull "redroid/redroid:${version}"
    echo "  [$cname] starting on ADB port $port..."
    docker run -d \
      --name "$cname" \
      --privileged \
      --rm \
      -p "${port}:5555" \
      "redroid/redroid:${version}"
  fi

  echo "  [$cname] waiting for boot (up to 60s)..."
  local waited=0
  while (( waited < 60 )); do
    if "$ADB_BIN" connect "localhost:${port}" 2>/dev/null && "$ADB_BIN" -s "localhost:${port}" shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; then
      echo "  [$cname] booted. ADB: localhost:${port}"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  echo "  [$cname] boot timed out — check with: docker logs $cname"
  return 1
}

stop() {
  local target="${1:-all}"
  if [[ "$target" == "all" ]]; then
    for name in "${!ADB_PORTS[@]}"; do
      docker rm -f "$(container_name "$name")" 2>/dev/null || true
    done
    "$ADB_BIN" kill-server 2>/dev/null || true
  else
    docker rm -f "$(container_name "$target")" 2>/dev/null || true
  fi
  echo "  stopped."
}

list() {
  echo "  redroid containers:"
  docker ps -a --filter 'name=redroid-*' --format '  {{.Names}}  {{.Status}}' || true
  echo "  ADB devices:"
  "$ADB_BIN" devices 2>/dev/null || echo "  (adb not found)"
}

connect_all() {
  for name in "${!ADB_PORTS[@]}"; do
    local port="${ADB_PORTS[$name]}"
    "$ADB_BIN" connect "localhost:${port}" 2>/dev/null || true
    echo "  connected to $name on port $port"
  done
}

run_app() {
  local name="$1"
  local mode="$2"
  local app_dir="${3:-$PULSEFLOW_FLUTTER/example}"
  local port="${ADB_PORTS[$name]}"

  if [[ ! -d "$app_dir" ]]; then
    echo "  App dir not found: $app_dir" >&2
    echo "  Clone pulseflow_flutter or set PULSEFLOW_FLUTTER=/path/to/pulseflow_flutter" >&2
    return 1
  fi

  "$ADB_BIN" connect "localhost:${port}" 2>/dev/null || true
  local device_id
  device_id="$("$ADB_BIN" devices 2>/dev/null | grep "${port}" | awk '{print $1}')"
  if [[ -z "$device_id" ]]; then
    echo "  No redroid device on port $port. Run: ./redroid.sh start $name"
    return 1
  fi

  echo "  Running app in $mode mode on $device_id..."
  (cd "$app_dir" && "$FLUTTER_BIN" run "--${mode}" -d "$device_id")
}

case "${1:-}" in
  start)   start "${2:-debug}" "${3:-}" ;;
  stop)    stop "${2:-all}" ;;
  list)    list ;;
  connect) connect_all ;;
  run)     run_app "${2:-debug}" "${3:-debug}" "${4:-}" ;;
  *) echo "Usage: $0 {start <name> [ver] | stop <name>|all | list | connect | run <name> <mode> [app-dir]}" ;;
esac
