#!/usr/bin/env bash
# Clone + build NetrisTV/ws-scrcpy for the PulseFlow device mirror pane.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$ROOT/ws-scrcpy"
URL="${WS_SCRCPY_REPO:-https://github.com/NetrisTV/ws-scrcpy.git}"
# PR #344 — Android 14/15 scrcpy-server (needed for redroid:14)
REF="${WS_SCRCPY_REF:-refs/pull/344/head}"

if ! command -v node >/dev/null 2>&1; then
  echo "device-mirror: Node.js is required." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "device-mirror: npm is required." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "device-mirror: git is required." >&2
  exit 1
fi

if [[ ! -d "$REPO/.git" ]]; then
  echo "device-mirror: cloning ws-scrcpy…"
  git clone --depth 1 "$URL" "$REPO"
fi

# Ensure Android 14+ server (shallow fetch of the PR ref).
if ! git -C "$REPO" rev-parse --verify android14 >/dev/null 2>&1; then
  echo "device-mirror: fetching Android 14/15 support (PR #344)…"
  git -C "$REPO" fetch --depth 1 origin "$REF:android14"
fi
git -C "$REPO" checkout -q android14

cp -f "$ROOT/build.config.override.json" "$REPO/build.config.override.json"

if [[ ! -d "$REPO/node_modules" ]]; then
  echo "device-mirror: npm install (this may take a few minutes)…"
  (cd "$REPO" && npm install --legacy-peer-deps)
fi

HEAD="$(git -C "$REPO" rev-parse HEAD)"
STAMP="$REPO/.pulseflow-build-rev"
if [[ ! -f "$REPO/dist/index.js" ]] || [[ "$(cat "$STAMP" 2>/dev/null || true)" != "$HEAD" ]]; then
  echo "device-mirror: building ws-scrcpy…"
  (cd "$REPO" && npm run dist)
  echo "$HEAD" > "$STAMP"
fi

if [[ ! -d "$REPO/dist/node_modules" ]]; then
  echo "device-mirror: installing runtime deps in dist/…"
  (cd "$REPO/dist" && npm install --omit=dev)
fi

echo "device-mirror: ready."
