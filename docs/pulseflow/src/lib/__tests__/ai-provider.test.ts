import { describe, expect, it } from "vitest";
import {
  buildRequest,
  extractDelta,
  MAX_OUTPUT_TOKENS,
  parseSse,
  redact,
} from "@/lib/server/ai-provider";

describe("parseSse", () => {
  it("splits complete frames and keeps the partial buffer", () => {
    const { frames, rest } = parseSse('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(frames).toHaveLength(2);
    expect(frames[0].data).toBe('{"a":1}');
    expect(frames[1].data).toBe('{"b":2}');
    expect(rest).toContain('{"c"');
  });

  it("captures the event name", () => {
    const { frames } = parseSse("event: content_block_delta\ndata: {}\n\n");
    expect(frames[0].event).toBe("content_block_delta");
  });
});

describe("extractDelta", () => {
  it("reads an OpenAI delta", () => {
    const data = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    expect(extractDelta("openai", { data })).toBe("hi");
  });

  it("ignores the OpenAI [DONE] sentinel", () => {
    expect(extractDelta("openai", { data: "[DONE]" })).toBe("");
  });

  it("reads an Anthropic content_block_delta", () => {
    const data = JSON.stringify({ delta: { text: "yo" } });
    expect(extractDelta("anthropic", { event: "content_block_delta", data })).toBe("yo");
  });

  it("ignores non-delta Anthropic events", () => {
    expect(extractDelta("anthropic", { event: "message_start", data: "{}" })).toBe("");
  });

  it("reads Gemini parts", () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
    });
    expect(extractDelta("gemini", { data })).toBe("ab");
  });

  it("returns empty on malformed JSON", () => {
    expect(extractDelta("openai", { data: "not json" })).toBe("");
  });
});

describe("buildRequest", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "hi" },
  ];

  it("builds an OpenAI-compatible request with a bearer header", () => {
    const request = buildRequest(
      { provider: "openai", apiKey: "k", model: "m", baseUrl: "https://api.x/v1" },
      messages,
    );
    expect(request.url).toBe("https://api.x/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer k");
    const body = request.body as { max_tokens: number; stream: boolean };
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.stream).toBe(true);
  });

  it("builds an Anthropic request with x-api-key and a system field", () => {
    const request = buildRequest(
      { provider: "anthropic", apiKey: "k", model: "m", baseUrl: "https://api.anthropic.com" },
      messages,
    );
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("k");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    const body = request.body as { max_tokens: number; system: string; messages: unknown[] };
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.system).toBe("sys");
    expect(body.messages).toHaveLength(1);
  });

  it("builds a Gemini request with the key in the query string", () => {
    const request = buildRequest(
      {
        provider: "gemini",
        apiKey: "k",
        model: "gemini-1.5-flash",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
      messages,
    );
    expect(request.url).toContain("gemini-1.5-flash:streamGenerateContent");
    expect(request.url).toContain("alt=sse");
    expect(request.url).toContain("key=k");
    const body = request.body as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("redact", () => {
  it("masks the secret everywhere it appears", () => {
    expect(redact("failed with sk-123 again sk-123", "sk-123")).toBe("failed with *** again ***");
  });

  it("is a no-op without a secret", () => {
    expect(redact("plain", undefined)).toBe("plain");
  });
});
