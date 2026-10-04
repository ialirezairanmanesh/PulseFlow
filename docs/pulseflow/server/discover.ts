/**
 * Discover local Dart / Flutter VM Service endpoints.
 * Combines mDNS (avahi), DDS/development-service, localhost port probing,
 * ADB forwards, and service-info files.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);

export type DiscoveredApp = {
  id: string;
  name: string;
  wsUrl: string;
  httpUrl: string;
  port: number;
  source: "mdns" | "port-scan" | "service-info" | "adb" | "dds";
  isolateName?: string;
  connectable: boolean;
  detail?: string;
  deviceName?: string;
};

type AdbForward = {
  serial: string;
  localPort: number;
  deviceName: string;
};

type FlutterRunHint = {
  deviceId: string;
  appName: string;
};

/** Auth + naming hints from `dart development-service` (DDS) processes. */
type DevelopmentServiceHint = {
  vmServiceHttpUrl: string;
  vmPort: number;
  authCode: string;
  appName?: string;
  deviceName?: string;
  packageName?: string;
};

const SKIP_PORTS = new Set([
  22, 80, 443, 3000, 3001, 5173, 8080, 8081, 8888, 9000, 9100,
  3846, 3847, // PulseFlow itself
]);

const DISCOVER_TIMEOUT_MS = 8000;

function toWsUrl(httpOrWs: string): string {
  const u = new URL(httpOrWs);
  if (u.protocol === "http:") u.protocol = "ws:";
  if (u.protocol === "https:") u.protocol = "wss:";
  let path = u.pathname || "/";
  if (path.endsWith("/ws") || path.endsWith("/ws/")) {
    u.pathname = path.replace(/\/+$/, "");
    return u.toString();
  }
  if (!path.endsWith("/")) path += "/";
  u.pathname = `${path}ws`;
  return u.toString();
}

function toHttpUrl(host: string, port: number, authCode = ""): string {
  let auth = authCode.trim();
  if (auth && !auth.endsWith("/")) auth += "/";
  if (auth.startsWith("/")) auth = auth.slice(1);
  return `http://${host}:${port}/${auth}`;
}

function appId(wsUrl: string): string {
  return wsUrl.replace(/\/+$/, "");
}

function parseProcPorts(content: string, ipv6 = false): Array<{ port: number; inode: string }> {
  const ports: Array<{ port: number; inode: string }> = [];
  for (const line of content.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10) continue;
    const local = cols[1];
    const state = cols[3];
    if (state !== "0A") continue; // LISTEN
    const [addrHex, portHex] = local.split(":");
    if (!addrHex || !portHex) continue;
    const port = Number.parseInt(portHex, 16);
    if (!Number.isFinite(port) || port <= 0) continue;
    if (!ipv6) {
      if (addrHex !== "0100007F" && addrHex !== "00000000") continue;
    } else {
      const isLocal =
        addrHex === "00000000000000000000000001000000" ||
        addrHex === "00000000000000000000000000000000";
      if (!isLocal) continue;
    }
    ports.push({ port, inode: cols[9] });
  }
  return ports;
}

async function listListeningPorts(): Promise<number[]> {
  const ports = new Set<number>();
  try {
    const tcp = await readFile("/proc/net/tcp", "utf8");
    for (const p of parseProcPorts(tcp, false)) ports.add(p.port);
  } catch {
    /* ignore */
  }
  try {
    const tcp6 = await readFile("/proc/net/tcp6", "utf8");
    for (const p of parseProcPorts(tcp6, true)) ports.add(p.port);
  } catch {
    /* ignore */
  }
  return [...ports].filter((p) => !SKIP_PORTS.has(p)).sort((a, b) => a - b);
}

function isDevToolsHttp(body: string, status: number): boolean {
  return (
    status === 200 &&
    (/Flutter Authors/i.test(body) ||
      /DevTools/i.test(body) ||
      /OBSERVER SCRIPT PLACEHOLDER/i.test(body))
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function listAdbDevices(): Promise<Map<string, string>> {
  const devices = new Map<string, string>();
  try {
    const { stdout } = await execFileAsync("adb", ["devices", "-l"], {
      timeout: 2500,
      maxBuffer: 256 * 1024,
    });
    for (const line of stdout.split("\n").slice(1)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("*")) continue;
      const parts = trimmed.split(/\s+/);
      const serial = parts[0];
      if (!serial || parts[1] !== "device") continue;
      const model = /model:(\S+)/.exec(trimmed)?.[1]?.replace(/_/g, " ");
      const product = /product:(\S+)/.exec(trimmed)?.[1];
      const device = /device:(\S+)/.exec(trimmed)?.[1];
      devices.set(serial, model || device || product || serial);
    }
  } catch {
    /* adb missing */
  }
  return devices;
}

async function listAdbForwards(): Promise<Map<number, AdbForward>> {
  const byPort = new Map<number, AdbForward>();
  const devices = await listAdbDevices();
  try {
    const { stdout } = await execFileAsync("adb", ["forward", "--list"], {
      timeout: 2500,
      maxBuffer: 256 * 1024,
    });
    for (const line of stdout.split("\n")) {
      // serial tcp:LOCAL tcp:REMOTE
      const m = /^(\S+)\s+tcp:(\d+)\s+tcp:(\d+)\s*$/.exec(line.trim());
      if (!m) continue;
      const serial = m[1];
      const localPort = Number(m[2]);
      if (!Number.isFinite(localPort)) continue;
      byPort.set(localPort, {
        serial,
        localPort,
        deviceName: devices.get(serial) ?? serial,
      });
    }
  } catch {
    /* ignore */
  }
  return byPort;
}

async function listFlutterRunHints(): Promise<FlutterRunHint[]> {
  const hints: FlutterRunHint[] = [];
  try {
    const procEntries = await readdir("/proc");
    for (const pid of procEntries) {
      if (!/^\d+$/.test(pid)) continue;
      let cmdline = "";
      try {
        cmdline = (await readFile(`/proc/${pid}/cmdline`)).toString("utf8").replace(/\0/g, "\0");
      } catch {
        continue;
      }
      if (!/flutter_tools\.snapshot/.test(cmdline) || !/\brun\b/.test(cmdline.replace(/\0/g, " "))) {
        continue;
      }
      const args = cmdline.split("\0").filter(Boolean);
      let deviceId = "";
      let target = "";
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-d" || args[i] === "--device-id") deviceId = args[i + 1] ?? "";
        if (args[i] === "--target" || args[i] === "-t") target = args[i + 1] ?? "";
        if (args[i]?.startsWith("--target=")) target = args[i].slice("--target=".length);
      }
      if (!deviceId && !target) continue;
      let appName = "Flutter app";
      if (target) {
        // .../my_app/lib/main.dart → my_app
        const dir = basename(dirname(dirname(target)));
        if (dir && dir !== "." && dir !== "lib") appName = dir;
        else appName = basename(target).replace(/\.dart$/i, "") || appName;
      }
      hints.push({ deviceId, appName });
    }
  } catch {
    /* ignore */
  }
  return hints;
}

function displayNameForPort(opts: {
  port: number;
  isolateName?: string;
  vmName?: string;
  adb?: AdbForward;
  flutterHints: FlutterRunHint[];
  needsAuth: boolean;
}): string {
  if (opts.isolateName && !/^main$/i.test(opts.isolateName)) {
    return opts.isolateName;
  }

  const hint =
    opts.flutterHints.find((h) => h.deviceId && opts.adb && h.deviceId === opts.adb.serial) ??
    opts.flutterHints.find((h) => h.deviceId && opts.adb && opts.adb.serial.startsWith(h.deviceId)) ??
    (opts.adb ? opts.flutterHints[0] : undefined);

  if (opts.adb) {
    const parts = [hint?.appName, opts.adb.deviceName].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }

  if (opts.isolateName) return opts.isolateName;
  if (opts.vmName && !/vm/i.test(opts.vmName)) return opts.vmName;
  if (opts.needsAuth) return `Dart VM :${opts.port}`;
  return `Flutter :${opts.port}`;
}

function httpGet(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString("utf8").slice(0, 4000),
        });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function parseAppNameFlag(raw: string): {
  appName?: string;
  deviceName?: string;
  packageName?: string;
} {
  // Kind: Flutter - Device: SM S721B - Package: factor_flutter
  const device = /Device:\s*([^-]+?)(?:\s+-|$)/i.exec(raw)?.[1]?.trim();
  const pkg = /Package:\s*(.+)$/i.exec(raw)?.[1]?.trim();
  const appName = pkg?.replace(/_/g, "-") || raw.trim() || undefined;
  return { appName, deviceName: device, packageName: pkg };
}

async function listDevelopmentServiceHints(): Promise<DevelopmentServiceHint[]> {
  const hints: DevelopmentServiceHint[] = [];
  try {
    const procEntries = await readdir("/proc");
    for (const pid of procEntries) {
      if (!/^\d+$/.test(pid)) continue;
      let args: string[] = [];
      try {
        const raw = await readFile(`/proc/${pid}/cmdline`);
        args = raw.toString("utf8").split("\0").filter(Boolean);
      } catch {
        continue;
      }
      if (!args.some((a) => a === "development-service" || a.endsWith("development-service"))) {
        continue;
      }
      let vmUri = "";
      let appFlag = "";
      for (const a of args) {
        if (a.startsWith("--vm-service-uri=")) vmUri = a.slice("--vm-service-uri=".length);
        if (a.startsWith("--app-name=")) appFlag = a.slice("--app-name=".length);
      }
      if (!vmUri) continue;
      try {
        const u = new URL(vmUri);
        const port = Number(u.port);
        if (!Number.isFinite(port) || port <= 0) continue;
        const authCode = u.pathname.replace(/^\/+|\/+$/g, "");
        const named = parseAppNameFlag(appFlag);
        hints.push({
          vmServiceHttpUrl: vmUri.endsWith("/") ? vmUri : `${vmUri}/`,
          vmPort: port,
          authCode,
          ...named,
        });
      } catch {
        /* bad uri */
      }
    }
  } catch {
    /* ignore */
  }
  return hints;
}

/**
 * Flutter's device VM Service (often ADB-forwarded) redirects to DDS with the
 * real browser-facing URL + auth token. Capture Location without following it.
 */
async function resolveDdsHttpUrl(vmServiceHttpUrl: string): Promise<string | null> {
  try {
    const res = await httpGet(vmServiceHttpUrl, 1200);
    const locRaw = res.headers.location;
    const loc = Array.isArray(locRaw) ? locRaw[0] : locRaw;
    if (!loc) return res.status >= 200 && res.status < 300 ? vmServiceHttpUrl : null;

    try {
      const locUrl = new URL(loc, vmServiceHttpUrl);
      const embedded = locUrl.searchParams.get("uri");
      if (embedded) {
        // uri=ws://127.0.0.1:PORT/AUTH=/ws → http://127.0.0.1:PORT/AUTH=/
        const ws = new URL(embedded);
        let path = ws.pathname.replace(/\/ws\/?$/, "/");
        if (!path.endsWith("/")) path += "/";
        return `${ws.protocol === "wss:" ? "https:" : "http:"}//${ws.host}${path}`;
      }
      // http://127.0.0.1:PORT/AUTH=/devtools/... → http://127.0.0.1:PORT/AUTH=/
      const parts = locUrl.pathname.split("/").filter(Boolean);
      const auth = parts[0] && parts[0].includes("=") ? parts[0] : "";
      if (auth) return toHttpUrl(locUrl.hostname, Number(locUrl.port || 0), auth);
      return `${locUrl.protocol}//${locUrl.host}/`;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function discoverViaDevelopmentService(
  adbForwards: Map<number, AdbForward>,
): Promise<DiscoveredApp[]> {
  const hints = await listDevelopmentServiceHints();
  const apps: DiscoveredApp[] = [];

  for (const hint of hints) {
    const ddsHttp = (await resolveDdsHttpUrl(hint.vmServiceHttpUrl)) ?? hint.vmServiceHttpUrl;
    const wsUrl = toWsUrl(ddsHttp);
    let port = hint.vmPort;
    try {
      port = Number(new URL(ddsHttp).port) || hint.vmPort;
    } catch {
      /* keep vm port */
    }
    const probe = await probeVmOverWs(wsUrl, 1200);
    const adb = adbForwards.get(hint.vmPort);
    const nameParts = [hint.appName, hint.deviceName ?? adb?.deviceName].filter(Boolean);
    apps.push({
      id: appId(wsUrl),
      name: nameParts.length ? nameParts.join(" · ") : `Flutter :${port}`,
      wsUrl,
      httpUrl: ddsHttp,
      port,
      source: "dds",
      isolateName: probe?.isolateName,
      connectable: Boolean(probe),
      deviceName: hint.deviceName ?? adb?.deviceName,
      detail: probe
        ? "Dart Development Service (from flutter run)"
        : "DDS found but WebSocket probe failed",
    });
  }
  return apps;
}

async function probeVmOverWs(
  wsUrl: string,
  timeoutMs: number,
): Promise<{ isolateName?: string; vmName?: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { isolateName?: string; vmName?: string } | null) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => finish(null), timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: "1", method: "getVM" }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          id?: string;
          result?: {
            name?: string;
            isolates?: Array<{ name?: string; isSystemIsolate?: boolean }>;
          };
          error?: unknown;
        };
        if (msg.id !== "1") return;
        clearTimeout(timer);
        if (msg.error || !msg.result) {
          finish(null);
          return;
        }
        const isolates = msg.result.isolates ?? [];
        const main =
          isolates.find((i) => !i.isSystemIsolate && /main/i.test(i.name ?? "")) ??
          isolates.find((i) => !i.isSystemIsolate) ??
          isolates[0];
        finish({
          vmName: msg.result.name,
          isolateName: main?.name,
        });
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });

    ws.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (!settled) finish(null);
    });
  });
}

async function discoverViaMdns(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  try {
    const { stdout } = await execFileAsync(
      "avahi-browse",
      ["-rpt", "_dartVmService._tcp"],
      { timeout: 2500, maxBuffer: 1024 * 1024 },
    );
    for (const line of stdout.split("\n")) {
      // =;iface;IPv4;name;_dartVmService._tcp;local;host;address;port;txt...
      if (!line.startsWith("=")) continue;
      const parts = line.split(";");
      if (parts.length < 9) continue;
      const serviceName = parts[3] || "Flutter app";
      const host = parts[7] || "127.0.0.1";
      const port = Number(parts[8]);
      if (!Number.isFinite(port)) continue;
      const txt = parts.slice(9).join(";");
      const authMatch = /authCode=([^"]+)/.exec(txt.replace(/"/g, "\n"));
      let auth = authMatch?.[1]?.trim() ?? "";
      if (!auth) {
        const m2 = txt.match(/authCode=([^\s;"]+)/);
        auth = m2?.[1] ?? "";
      }
      const httpUrl = toHttpUrl(host === "0.0.0.0" ? "127.0.0.1" : host, port, auth);
      const wsUrl = toWsUrl(httpUrl);
      const probe = await probeVmOverWs(wsUrl, 900);
      apps.push({
        id: appId(wsUrl),
        name: serviceName.replace(/\._dartVmService\._tcp\.local$/i, "") || `Flutter :${port}`,
        wsUrl,
        httpUrl,
        port,
        source: "mdns",
        isolateName: probe?.isolateName,
        connectable: Boolean(probe),
        detail: probe ? "Found via mDNS" : "Found via mDNS (could not verify yet)",
      });
    }
  } catch {
    /* avahi missing or no results */
  }
  return apps;
}

async function discoverServiceInfoFiles(): Promise<DiscoveredApp[]> {
  const apps: DiscoveredApp[] = [];
  const roots = ["/tmp"];
  const files: string[] = [];

  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const ent of entries) {
        const name = ent.name.toLowerCase();
        if (
          name.includes("service") &&
          (name.includes("info") || name.includes("vm")) &&
          (name.endsWith(".json") || name.endsWith(".txt"))
        ) {
          files.push(join(root, ent.name));
        }
        if (ent.isDirectory() && name.startsWith("flutter_tools")) {
          try {
            const nested = await readdir(join(root, ent.name));
            for (const n of nested) {
              if (n.endsWith(".json") && /service|vm/i.test(n)) {
                files.push(join(root, ent.name, n));
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const file of files.slice(0, 40)) {
    try {
      const raw = await readFile(file, "utf8");
      const data = JSON.parse(raw) as {
        uri?: string;
        url?: string;
        port?: number;
        authentication_code?: string;
        authCode?: string;
      };
      let httpUrl = data.uri ?? data.url;
      if (!httpUrl && data.port) {
        httpUrl = toHttpUrl(
          "127.0.0.1",
          data.port,
          data.authentication_code ?? data.authCode ?? "",
        );
      }
      if (!httpUrl) continue;
      const wsUrl = toWsUrl(httpUrl);
      const port = Number(new URL(httpUrl).port || 0);
      const probe = await probeVmOverWs(wsUrl, 900);
      apps.push({
        id: appId(wsUrl),
        name: probe?.isolateName ?? `VM service :${port}`,
        wsUrl,
        httpUrl,
        port,
        source: "service-info",
        isolateName: probe?.isolateName,
        connectable: Boolean(probe),
        detail: `From ${file}`,
      });
    } catch {
      /* ignore bad files */
    }
  }
  return apps;
}

async function probePort(
  port: number,
  adb: AdbForward | undefined,
  flutterHints: FlutterRunHint[],
  ddsAuthByVmPort: Map<number, DevelopmentServiceHint>,
): Promise<DiscoveredApp | null> {
  const ddsHint = ddsAuthByVmPort.get(port);

  // Prefer resolving through DDS when flutter run has already started development-service.
  if (ddsHint) {
    const ddsHttp = (await resolveDdsHttpUrl(ddsHint.vmServiceHttpUrl)) ?? ddsHint.vmServiceHttpUrl;
    const wsUrl = toWsUrl(ddsHttp);
    let resolvedPort = port;
    try {
      resolvedPort = Number(new URL(ddsHttp).port) || port;
    } catch {
      /* keep */
    }
    const probe = await probeVmOverWs(wsUrl, 1200);
    const nameParts = [ddsHint.appName, ddsHint.deviceName ?? adb?.deviceName].filter(Boolean);
    return {
      id: appId(wsUrl),
      name: nameParts.length
        ? nameParts.join(" · ")
        : displayNameForPort({
            port: resolvedPort,
            isolateName: probe?.isolateName,
            adb,
            flutterHints,
            needsAuth: !probe,
          }),
      wsUrl,
      httpUrl: ddsHttp,
      port: resolvedPort,
      source: "dds",
      isolateName: probe?.isolateName,
      connectable: Boolean(probe),
      deviceName: ddsHint.deviceName ?? adb?.deviceName,
      detail: probe
        ? "Dart Development Service (from flutter run)"
        : "DDS found but WebSocket probe failed",
    };
  }

  const plainWs = `ws://127.0.0.1:${port}/ws`;
  const httpUrl = `http://127.0.0.1:${port}/`;

  let res: { status: number; headers: Record<string, string | string[] | undefined>; body: string } | null =
    null;
  try {
    res = await httpGet(httpUrl, adb ? 900 : 350);
  } catch {
    res = null;
  }

  if (res && isDevToolsHttp(res.body, res.status)) return null;

  const poweredBy = String(res?.headers["x-powered-by"] ?? "");
  const looksDart =
    !!res &&
    (/dart/i.test(poweredBy) ||
      /Dart VM Service|Observatory|package:shelf/i.test(res.body) ||
      /missing or invalid authentication code/i.test(res.body));

  // ADB forwards are Flutter debug tunnels — keep them even if HTTP is slow/hung.
  if (!looksDart && !adb) return null;

  const needsAuth =
    !!res &&
    (/missing or invalid authentication code/i.test(res.body) || res.status === 403);

  // Auth-gated localhost Dart without ADB is almost always IDE tooling (DTD, etc.).
  if (!adb && needsAuth) {
    const probe = await probeVmOverWs(plainWs, 500);
    if (!probe) return null;
    return {
      id: appId(plainWs),
      name: displayNameForPort({
        port,
        isolateName: probe.isolateName,
        vmName: probe.vmName,
        flutterHints,
        needsAuth: false,
      }),
      wsUrl: plainWs,
      httpUrl,
      port,
      source: "port-scan",
      isolateName: probe.isolateName,
      connectable: true,
      detail: "Found by scanning localhost ports",
    };
  }

  const probe = looksDart || adb ? await probeVmOverWs(plainWs, adb ? 900 : 700) : null;
  const name = displayNameForPort({
    port,
    isolateName: probe?.isolateName,
    vmName: probe?.vmName,
    adb,
    flutterHints,
    needsAuth: !probe,
  });

  return {
    id: probe ? appId(plainWs) : `port-${port}`,
    name,
    wsUrl: plainWs,
    httpUrl,
    port,
    source: adb ? "adb" : "port-scan",
    isolateName: probe?.isolateName,
    connectable: Boolean(probe),
    deviceName: adb?.deviceName,
    detail: adb
      ? probe
        ? "via ADB"
        : needsAuth || !res
          ? "ADB forward — paste full VM Service URL from flutter run"
          : "ADB forward"
      : probe
        ? "Found by scanning localhost ports"
        : "Detected Dart HTTP service (could not open VM WebSocket)",
  };
}

async function discoverViaPortScan(): Promise<DiscoveredApp[]> {
  const [ports, adbForwards, flutterHints, ddsHints] = await Promise.all([
    listListeningPorts(),
    listAdbForwards(),
    listFlutterRunHints(),
    listDevelopmentServiceHints(),
  ]);

  const ddsAuthByVmPort = new Map(ddsHints.map((h) => [h.vmPort, h]));

  const candidates = new Set<number>();
  for (const p of ports.filter((p) => p >= 1024).slice(0, 80)) candidates.add(p);
  for (const p of adbForwards.keys()) candidates.add(p);
  for (const h of ddsHints) candidates.add(h.vmPort);

  const apps: DiscoveredApp[] = [];
  const list = [...candidates];
  const batchSize = 12;

  for (let i = 0; i < list.length; i += batchSize) {
    const slice = list.slice(i, i + batchSize);
    const results = await Promise.all(
      slice.map((port) => probePort(port, adbForwards.get(port), flutterHints, ddsAuthByVmPort)),
    );
    for (const r of results) {
      if (r) apps.push(r);
    }
  }
  return apps;
}

export async function discoverRunningApps(): Promise<DiscoveredApp[]> {
  const byPort = new Map<number, DiscoveredApp>();
  const adbForwards = await listAdbForwards();

  const merge = (list: DiscoveredApp[]) => {
    for (const app of list) {
      const prev = byPort.get(app.port);
      if (!prev) {
        byPort.set(app.port, app);
        continue;
      }
      const preferApp =
        (app.connectable && !prev.connectable) ||
        (app.connectable === prev.connectable && sourceRank(app.source) < sourceRank(prev.source));
      byPort.set(app.port, {
        ...prev,
        ...app,
        name: scoreName(app.name, app) >= scoreName(prev.name, prev) ? app.name : prev.name,
        connectable: app.connectable || prev.connectable,
        isolateName: app.isolateName ?? prev.isolateName,
        deviceName: app.deviceName ?? prev.deviceName,
        detail: preferApp
          ? (app.detail ?? prev.detail)
          : app.connectable
            ? app.detail
            : prev.connectable
              ? prev.detail
              : (app.detail ?? prev.detail),
        source: preferApp ? app.source : sourceRank(app.source) < sourceRank(prev.source) ? app.source : prev.source,
        wsUrl: preferApp ? app.wsUrl : prev.connectable ? prev.wsUrl : app.wsUrl,
        httpUrl: preferApp ? app.httpUrl : prev.connectable ? prev.httpUrl : app.httpUrl,
        id: preferApp ? app.id : prev.connectable ? prev.id : app.id,
      });
    }
  };

  const settled = await Promise.all([
    withTimeout(discoverViaDevelopmentService(adbForwards), 4000, []),
    withTimeout(discoverViaMdns(), 3000, []),
    withTimeout(discoverServiceInfoFiles(), 3000, []),
    withTimeout(discoverViaPortScan(), DISCOVER_TIMEOUT_MS, []),
  ]);

  for (const list of settled) merge(list);

  // Drop stale ADB placeholders when a connectable DDS entry already covers the app.
  const connectableKeys = new Set(
    [...byPort.values()]
      .filter((a) => a.connectable)
      .map((a) => `${a.deviceName ?? ""}|${a.name.split(" · ")[0]}`),
  );
  for (const [port, app] of [...byPort.entries()]) {
    if (app.connectable) continue;
    if (app.source !== "adb") continue;
    const key = `${app.deviceName ?? ""}|${app.name.split(" · ")[0]}`;
    if (connectableKeys.has(key)) byPort.delete(port);
  }

  const apps = [...byPort.values()];
  const nameCounts = new Map<string, number>();
  for (const app of apps) {
    nameCounts.set(app.name, (nameCounts.get(app.name) ?? 0) + 1);
  }
  for (const app of apps) {
    if ((nameCounts.get(app.name) ?? 0) > 1) {
      app.name = `${app.name} · :${app.port}`;
    }
  }

  return apps.sort((a, b) => {
    if (a.connectable !== b.connectable) return a.connectable ? -1 : 1;
    const rank = sourceRank(a.source) - sourceRank(b.source);
    if (rank !== 0) return rank;
    return a.port - b.port;
  });
}

function sourceRank(source: DiscoveredApp["source"]): number {
  switch (source) {
    case "dds":
      return 0;
    case "mdns":
      return 1;
    case "service-info":
      return 2;
    case "adb":
      return 3;
    default:
      return 4;
  }
}

function scoreName(name: string, app: DiscoveredApp): number {
  let score = 0;
  if (app.source === "dds") score += 5;
  if (app.deviceName && name.includes(app.deviceName)) score += 4;
  if (app.isolateName && name === app.isolateName) score += 3;
  if (!/^Dart (VM|service) :\d+$/i.test(name)) score += 2;
  if (name.includes("·")) score += 1;
  return score;
}
