/**
 * Shared AI provider metadata and settings helpers.
 *
 * Pure module (no node:fs) so both the server route handlers and the client
 * components can import it without pulling Node built-ins into the browser bundle.
 */

export type AiProvider = "openai" | "anthropic" | "gemini";
export type AiLanguage = "fa" | "en";

export interface AiSettings {
  provider: AiProvider;
  apiKey?: string;
  model?: string;
  /** OpenAI-compatible endpoints only; ignored by anthropic/gemini. */
  baseUrl?: string;
  language?: AiLanguage;
  updatedAt?: number;
}

export interface PublicAiSettings {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  language: AiLanguage;
  hasKey: boolean;
}

export interface ProviderMeta {
  id: AiProvider;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: "openai",
    label: "OpenAI-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-1.5-flash",
  },
] as const;

export const DEFAULT_LANGUAGE: AiLanguage = "fa";

export function providerMeta(id: AiProvider): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

export function isAiProvider(value: unknown): value is AiProvider {
  return PROVIDERS.some((p) => p.id === value);
}

export interface ResolvedAiSettings {
  provider: AiProvider;
  apiKey?: string;
  model: string;
  baseUrl: string;
  language: AiLanguage;
}

/** Fills provider/model/baseUrl/language defaults; never requires a key. */
export function resolveSettings(settings: AiSettings | null): ResolvedAiSettings {
  const provider = settings && isAiProvider(settings.provider) ? settings.provider : "openai";
  const meta = providerMeta(provider);
  return {
    provider,
    apiKey: settings?.apiKey?.trim() || undefined,
    model: settings?.model?.trim() || meta.defaultModel,
    baseUrl: (settings?.baseUrl?.trim() || meta.defaultBaseUrl).replace(/\/+$/, ""),
    language: settings?.language === "en" ? "en" : DEFAULT_LANGUAGE,
  };
}

/** The only shape ever sent to the browser — the API key is never included. */
export function publicAiSettings(settings: AiSettings | null): PublicAiSettings {
  const resolved = resolveSettings(settings);
  return {
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    language: resolved.language,
    hasKey: Boolean(settings?.apiKey?.trim()),
  };
}
