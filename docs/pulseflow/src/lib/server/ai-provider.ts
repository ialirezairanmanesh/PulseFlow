import type { ChatMessage } from "@/lib/ai-context";
import { resolveSettings, type AiProvider, type AiSettings } from "@/lib/ai-providers";

export interface SseFrame {
  event?: string;
  data: string;
}

interface RequestParts {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Splits a raw SSE buffer into complete frames plus the trailing partial buffer.
 * SSE frames are separated by a blank line; `data:` lines are joined with "\n".
 */
export function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const part of parts) {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

/** Extracts the text delta from one provider SSE frame ("" when it carries none). */
export function extractDelta(provider: AiProvider, frame: SseFrame): string {
  if (frame.data === "[DONE]") return "";
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return "";
  }
  switch (provider) {
    case "openai": {
      const choice = asRecord(asArray(asRecord(json).choices)[0]);
      return asString(asRecord(choice.delta).content);
    }
    case "anthropic": {
      if (frame.event && frame.event !== "content_block_delta") return "";
      return asString(asRecord(asRecord(json).delta).text);
    }
    case "gemini": {
      const candidate = asRecord(asArray(asRecord(json).candidates)[0]);
      const parts = asArray(asRecord(candidate.content).parts);
      return parts.map((p) => asString(asRecord(p).text)).join("");
    }
  }
}

export function redact(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

/** Shapes the provider-specific HTTP request for a chat completion. */
export function buildRequest(
  settings: { provider: AiProvider; apiKey: string; model: string; baseUrl: string },
  messages: ChatMessage[],
): RequestParts {
  const { provider, apiKey, model, baseUrl } = settings;

  if (provider === "openai") {
    return {
      url: `${baseUrl}/chat/completions`,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: { model, messages, stream: true },
    };
  }

  if (provider === "anthropic") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: { model, max_tokens: 1024, system, messages: rest, stream: true },
    };
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    url: `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      apiKey,
    )}`,
    headers: { "content-type": "application/json" },
    body: { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) },
  };
}

/** Streams text deltas from the configured provider. */
export async function* streamChat(
  settings: AiSettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const resolved = resolveSettings(settings);
  if (!resolved.apiKey) throw new Error("No API key configured");

  const { url, headers, body } = buildRequest(
    {
      provider: resolved.provider,
      apiKey: resolved.apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
    },
    messages,
  );

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = redact(await response.text().catch(() => ""), resolved.apiKey).slice(0, 500);
    throw new Error(
      `${resolved.provider} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSse(buffer);
    buffer = rest;
    for (const frame of frames) {
      const delta = extractDelta(resolved.provider, frame);
      if (delta) yield delta;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const { frames } = parseSse(`${buffer}\n\n`);
    for (const frame of frames) {
      const delta = extractDelta(resolved.provider, frame);
      if (delta) yield delta;
    }
  }
}
