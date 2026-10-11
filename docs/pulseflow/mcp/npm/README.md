# pulseflow-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server for
**[PulseFlow](https://github.com/ialirezairanmanesh/PulseFlow)** — a problems-first
Flutter performance lab. It lets a coding agent (**Cursor**, **Claude Code**,
**Command Code**) read a live Flutter session and find, fix, and verify performance
problems without copy-pasting reports.

The server connects to your running PulseFlow **bridge** and exposes the same ranked
problems, health score, and agent report the dashboard shows.

## Prerequisites

- **Node 18+**
- The **PulseFlow bridge** running (from the PulseFlow repo: `make run`, or `make bridge`).
- Your Flutter app running (debug for rebuilds/source, profile for CPU).

## Use it

No install needed — point your MCP client at `npx`:

**Cursor** — `.cursor/mcp.json` (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pulseflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "pulseflow-mcp"]
    }
  }
}
```

**Command Code** — `cmd mcp add pulseflow -- npx -y pulseflow-mcp`.

Then restart the client and, in the agent, run `pulseflow_connect` (or pass
`{"mock": true}` for a device-free demo) and ask:

> What are the top performance problems right now, and what should I fix first?

## Tools

- **Session**: `pulseflow_status`, `pulseflow_discover`, `pulseflow_connect`, `pulseflow_disconnect`
- **Findings**: `pulseflow_report`, `pulseflow_problems`, `pulseflow_widgets`, `pulseflow_frames`, `pulseflow_cpu`, `pulseflow_memory`, `pulseflow_network`, `pulseflow_device`, `pulseflow_errors`, `pulseflow_logs`
- **Controls**: `pulseflow_debug_option`, `pulseflow_hot_widgets`

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PULSEFLOW_BRIDGE_URL` | `ws://127.0.0.1:3847/bridge` | Bridge WebSocket to connect to |
| `PULSEFLOW_VM_URL` | – | Optional VM Service URL to auto-connect at startup |

## License

MIT
