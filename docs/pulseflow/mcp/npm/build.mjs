#!/usr/bin/env node
/**
 * Bundles the PulseFlow MCP server into a single, dependency-free file for npm.
 *
 *   node mcp/npm/build.mjs   ->   mcp/npm/dist/index.js
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url)); // docs/pulseflow/mcp/npm
const dash = path.resolve(here, "..", ".."); // docs/pulseflow
const entry = path.resolve(here, "..", "server.ts"); // docs/pulseflow/mcp/server.ts
const outfile = path.resolve(here, "dist", "index.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  // Resolve the dashboard's "@/..." path alias from its tsconfig.
  absWorkingDir: dash,
  tsconfig: path.resolve(dash, "tsconfig.json"),
  alias: { "@": path.resolve(dash, "src") },
  // `ws` optionally requires native accelerators; keep them optional.
  external: ["bufferutil", "utf-8-validate"],
  // server.ts already starts with the `#!/usr/bin/env node` shebang.
  legalComments: "none",
  logLevel: "info",
});
