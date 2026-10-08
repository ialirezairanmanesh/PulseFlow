/** Device mirror (ws-scrcpy) sidecar defaults. */

export const MIRROR_HOST =
  process.env.NEXT_PUBLIC_MIRROR_HOST?.trim() || "127.0.0.1";
export const MIRROR_PORT =
  process.env.NEXT_PUBLIC_MIRROR_PORT?.trim() || "3848";

/** Scrcpy websocket port inside the device (ws-scrcpy default). */
const SCRCPY_REMOTE_PORT = 8886;

export function mirrorBaseUrl(): string {
  return `http://${MIRROR_HOST}:${MIRROR_PORT}`;
}

/** Probe the mirror HTTP server (ws-scrcpy index or offline stub). */
export function mirrorHealthUrl(): string {
  return `${mirrorBaseUrl()}/`;
}

/**
 * Deep-link into NetrisTV/ws-scrcpy stream for an ADB serial.
 * Includes the required `ws` proxy-over-adb URL that StreamClientScrcpy expects.
 */
export function mirrorStreamUrl(serial: string): string {
  const proxy = new URL(`ws://${MIRROR_HOST}:${MIRROR_PORT}/`);
  proxy.searchParams.set("action", "proxy-adb");
  proxy.searchParams.set("remote", `tcp:${SCRCPY_REMOTE_PORT}`);
  proxy.searchParams.set("udid", serial);

  const hash = new URLSearchParams({
    action: "stream",
    udid: serial,
    // webcodecs is lower-latency than mse/broadway on Chromium; falls back
    // poorly only if the browser lacks VideoDecoder (rare for local Chrome).
    player: "webcodecs",
    // Scale the mirror to the iframe (ws-scrcpy defaults to a 480×480 box).
    fitToScreen: "true",
    ws: proxy.toString(),
  });
  return `${mirrorBaseUrl()}/#!${hash.toString()}`;
}
