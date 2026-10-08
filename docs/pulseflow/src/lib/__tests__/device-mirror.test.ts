import { describe, expect, it } from "vitest";
import { mirrorBaseUrl, mirrorStreamUrl } from "@/lib/device-mirror";

describe("device-mirror urls", () => {
  it("builds a health base url", () => {
    expect(mirrorBaseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("embeds proxy-adb ws url for a device serial", () => {
    const url = mirrorStreamUrl("localhost:5555");
    expect(url).toContain("http://127.0.0.1:");
    expect(url).toContain("#!");
    expect(url).toContain("action=stream");
    expect(url).toContain("udid=localhost");
    expect(url).toContain("player=webcodecs");
    expect(url).toContain("fitToScreen=true");
    expect(url).toContain("proxy-adb");
    expect(url).toContain("remote%3Dtcp");
    const hash = url.split("#!")[1] ?? "";
    const ws = new URLSearchParams(hash).get("ws") ?? "";
    expect(ws).toContain("action=proxy-adb");
    expect(ws).toContain("remote=tcp");
  });
});
