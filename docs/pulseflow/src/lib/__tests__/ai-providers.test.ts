import { describe, expect, it } from "vitest";
import { PROVIDERS, publicAiSettings, resolveSettings } from "@/lib/ai-providers";

describe("resolveSettings", () => {
  it("fills provider defaults when nothing is stored", () => {
    const resolved = resolveSettings(null);
    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe(PROVIDERS[0].defaultModel);
    expect(resolved.baseUrl).toBe(PROVIDERS[0].defaultBaseUrl);
    expect(resolved.language).toBe("fa");
  });

  it("trims the base URL and strips trailing slashes", () => {
    const resolved = resolveSettings({ provider: "openai", baseUrl: " https://my.host/v1/ " });
    expect(resolved.baseUrl).toBe("https://my.host/v1");
  });

  it("falls back to openai for an unknown provider", () => {
    const resolved = resolveSettings({ provider: "bogus" as never });
    expect(resolved.provider).toBe("openai");
  });

  it("treats a blank key as absent", () => {
    expect(resolveSettings({ provider: "anthropic", apiKey: "   " }).apiKey).toBeUndefined();
  });
});

describe("publicAiSettings", () => {
  it("never exposes the key and reports hasKey", () => {
    const pub = publicAiSettings({ provider: "anthropic", apiKey: "sk-super-secret" });
    expect(pub.hasKey).toBe(true);
    expect(pub).not.toHaveProperty("apiKey");
    expect(JSON.stringify(pub)).not.toContain("sk-super-secret");
  });

  it("reports no key when none is stored", () => {
    expect(publicAiSettings(null).hasKey).toBe(false);
  });
});
