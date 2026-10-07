#!/usr/bin/env node
/**
 * Minimal HTTP stub when ws-scrcpy is not built yet.
 * /health → 503 so DevicePane shows "Mirror offline".
 */
import http from "node:http";

const port = Number(process.argv[2] || process.env.PULSEFLOW_MIRROR_PORT || 3848);

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/health")) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: "ws-scrcpy not built" }));
    return;
  }
  res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
  res.end(
    "PulseFlow device mirror is not ready.\n" +
      "Run: docs/pulseflow/device-mirror/setup.sh\n",
  );
});

server.listen(port, "0.0.0.0", () => {
  console.log(`device-mirror stub listening on :${port} (offline)`);
});
