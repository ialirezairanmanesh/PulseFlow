#!/usr/bin/env bash
# Portable launcher for the PulseFlow MCP server (stdio) so the MCP config
# needs no working-directory assumptions.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

exec node_modules/.bin/tsx mcp/server.ts
