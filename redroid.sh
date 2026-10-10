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

# Display: default redroid is ~15fps which makes the mirror look like a slideshow.
# Override with REDROID_FPS / REDROID_WIDTH / REDROID_HEIGHT if needed.
REDROID_FPS="${REDROID_FPS:-30}"
REDROID_WIDTH="${REDROID_WIDTH:-1280}"
REDROID_HEIGHT="${REDROID_HEIGHT:-720}"

container_name() {
  echo "redroid-$1"
}

# Redroid needs Android binder IPC on the host. Ubuntu ships binder_linux as a
# module with CONFIG_ANDROID_BINDER_DEVICES="" so nothing appears under /dev
# until binderfs is mounted. Without it the container exits (~129) or ADB
# stays "Connection refused" until the wait times out.
ensure_binder() {
  if [[ -c /dev/binder ]] || [[ -c /dev/binderfs/binder ]]; then
    return 0
  fi

  echo "  [redroid] binder not found — loading binder_linux + mounting binderfs..."
  if ! docker run --rm --privileged --pid=host \
    -v /lib/modules:/lib/modules:ro \
    alpine:3.20 sh -c '
      set -e
      if ! grep -q "^binder_linux" /proc/modules 2>/dev/null; then
        ko="/lib/modules/$(uname -r)/kernel/drivers/android/binder_linux.ko"
        if [ -f "$ko" ]; then
          insmod "$ko" devices="binder,hwbinder,vndbinder" 2>/dev/null \
            || insmod "$ko" \
            || true
        fi
      fi
      nsenter -t 1 -m -- sh -c "
        mkdir -p /dev/binderfs
        mountpoint -q /dev/binderfs || mount -t binder binder /dev/binderfs
        test -c /dev/binderfs/binder
      "
    '; then
    echo "  [redroid] failed to set up binderfs." >&2
    echo "  Try manually:" >&2
    echo "    sudo modprobe binder_linux devices=binder,hwbinder,vndbinder" >&2
    echo "    sudo mkdir -p /dev/binderfs && sudo mount -t binder binder /dev/binderfs" >&2
    return 1
  fi
  echo "  [redroid] binderfs ready."
}

start() {
  local name="$1"
  local version="${2:-14.0.0-latest}"
  local port="${ADB_PORTS[$name]:-5575}"
  local cname
  local boot_timeout="${REDROID_BOOT_TIMEOUT:-90}"
  cname="$(container_name "$name")"

  ensure_binder

  if docker ps -a --format '{{.Names}}' | grep -q "^${cname}$"; then
    echo "  [$cname] already exists (stopped). Starting..."
    docker start "$cname" 2>/dev/null || true
  else
    echo "  [$cname] pulling redroid:${version}..."
    docker pull "redroid/redroid:${version}"
    echo "  [$cname] starting on ADB port $port (${REDROID_WIDTH}x${REDROID_HEIGHT}@${REDROID_FPS})..."
    docker run -d \
      --name "$cname" \
      --privileged \
      --rm \
      -p "${port}:5555" \
      "redroid/redroid:${version}" \
      androidboot.redroid_width="${REDROID_WIDTH}" \
      androidboot.redroid_height="${REDROID_HEIGHT}" \
      androidboot.redroid_fps="${REDROID_FPS}"
  fi

  # Drop stale ADB sessions from a previous container on the same port.
  "$ADB_BIN" disconnect "localhost:${port}" >/dev/null 2>&1 || true

  echo "  [$cname] waiting for boot (up to ${boot_timeout}s)..."
  local waited=0
  while (( waited < boot_timeout )); do
    if ! docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
      echo "  [$cname] container exited early — binder/host setup is usually the cause." >&2
      docker logs "$cname" 2>&1 | tail -40 >&2 || true
      return 1
    fi
    # Quiet connect/shell failures while Android is still booting.
    if "$ADB_BIN" connect "localhost:${port}" >/dev/null 2>&1 \
      && "$ADB_BIN" -s "localhost:${port}" shell getprop sys.boot_completed 2>/dev/null \
        | tr -d '\r' | grep -qx "1"; then
      echo "  [$cname] booted. ADB: localhost:${port}"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  echo "  [$cname] boot timed out — check with: docker logs $cname" >&2
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
