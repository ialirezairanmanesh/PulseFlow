import type { AiLanguage, AiProvider, ProviderMeta } from "@/lib/ai-providers";
import type { AiSection, ChatMessage } from "@/lib/ai-context";

export interface AiSettingsView {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  language: AiLanguage;
  hasKey: boolean;
  providers: ProviderMeta[];
}

export interface SaveAiPatch {
  provider?: AiProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  language?: AiLanguage;
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export async function getAiSettings(): Promise<AiSettingsView> {
  return jsonOrThrow<AiSettingsView>(await fetch("/api/ai/settings", { cache: "no-store" }));
}

export async function saveAiSettings(patch: SaveAiPatch): Promise<AiSettingsView> {
  return jsonOrThrow<AiSettingsView>(
    await fetch("/api/ai/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function clearAiSettings(): Promise<AiSettingsView> {
  return jsonOrThrow<AiSettingsView>(await fetch("/api/ai/settings", { method: "DELETE" }));
}

export interface AiTestResult {
  ok: boolean;
  error?: string;
  sample?: string;
}

export async function testAi(): Promise<AiTestResult> {
  const response = await fetch("/api/ai/test", { method: "POST" });
  return (await response.json().catch(() => ({
    ok: false,
    error: `Request failed (${response.status})`,
  }))) as AiTestResult;
}

export interface StreamAiOptions {
  section: AiSection;
  context: string;
  question?: string;
  history?: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

/** Streams an answer from the server route, invoking `onDelta` for each text chunk. */
export async function streamAiChat(options: StreamAiOptions): Promise<void> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      section: options.section,
      context: options.context,
      question: options.question,
      history: options.history,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      const rest = decoder.decode();
      if (rest) options.onDelta(rest);
      break;
    }
    options.onDelta(decoder.decode(value, { stream: true }));
  }
}
