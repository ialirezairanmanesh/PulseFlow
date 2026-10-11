#!/usr/bin/env bash
# Portable launcher for the PulseFlow MCP server (stdio) so the MCP config needs
# no working-directory assumptions.
#
# GUI MCP clients (Cursor, Claude) often spawn servers without a login-shell
# PATH, and some systems ship an ancient system `node` (e.g. v12). Prefer the
# newest nvm-managed Node when one is installed, else fall back to PATH.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

nvm_bin="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
if [[ -n "${nvm_bin:-}" && -x "$nvm_bin/node" ]]; then
  PATH="$nvm_bin:${PATH:-/usr/bin:/bin}"
  export PATH
fi

if ! command -v node >/dev/null 2>&1; then
  echo "pulseflow-mcp: Node.js 18+ not found on PATH" >&2
  exit 1
fi

exec node_modules/.bin/tsx mcp/server.ts
