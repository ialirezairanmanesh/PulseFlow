#!/usr/bin/env node
/**
 * PulseFlow MCP server (stdio).
 *
 * Connects to the PulseFlow bridge and exposes the session as MCP tools so a
 * coding agent can find, fix, and verify Flutter performance problems.
 *
 * IMPORTANT: stdout carries MCP protocol frames only — all logging goes to stderr.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, findTool, type ToolContext } from "@/lib/mcp/tools";
import { BridgeClient } from "./bridge-client";

const BRIDGE_URL =
  process.env.PULSEFLOW_BRIDGE_URL?.trim() || "ws://127.0.0.1:3847/bridge";
const AUTO_CONNECT_URL = process.env.PULSEFLOW_VM_URL?.trim() || "";

function log(message: string): void {
  process.stderr.write(`[pulseflow-mcp] ${message}\n`);
}

const client = new BridgeClient({ url: BRIDGE_URL, log });
client.connect();

if (AUTO_CONNECT_URL) {
  // Give the socket a moment, then auto-connect to the app the user pointed at.
  setTimeout(() => {
    try {
      client.send({ type: "connect", url: AUTO_CONNECT_URL });
      log(`auto-connecting to ${AUTO_CONNECT_URL}`);
    } catch (err) {
      log(`auto-connect skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 800);
}

const reportDir = mkdtempSync(join(tmpdir(), "pulseflow-mcp-"));

function makeContext(): ToolContext {
  return {
    state: client.state,
    send: (msg) => client.send(msg),
    waitFor: (type, timeoutMs) => client.waitFor(type, timeoutMs),
    writeFile: (fileName, content) => {
      const path = join(reportDir, fileName);
      writeFileSync(path, content, "utf8");
      return path;
    },
    log,
  };
}

const server = new Server(
  { name: "pulseflow", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const tool = findTool(request.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  }
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    const result = await tool.handler(makeContext(), args);
    return { content: result.content, isError: result.isError };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`tool ${tool.name} failed: ${message}`);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready — bridge ${BRIDGE_URL}, ${TOOLS.length} tools`);
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
