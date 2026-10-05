import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isAiProvider,
  type AiLanguage,
  type AiProvider,
  type AiSettings,
} from "@/lib/ai-providers";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "ai-settings.json");

export async function getAiSettings(): Promise<AiSettings | null> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return isAiProvider(parsed.provider) ? (parsed as AiSettings) : null;
  } catch {
    return null;
  }
}

async function writeSettings(settings: AiSettings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(settings, null, 2), "utf8");
}

/** Merges a patch into the stored settings. An empty `apiKey` string clears the key. */
export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const current = (await getAiSettings()) ?? null;
  const provider: AiProvider = isAiProvider(patch.provider)
    ? patch.provider
    : (current?.provider ?? "openai");

  const next: AiSettings = {
    provider,
    model: pickString(patch.model, current?.model),
    baseUrl: pickString(patch.baseUrl, current?.baseUrl),
    language: pickLanguage(patch.language, current?.language),
  };

  const apiKey =
    patch.apiKey === undefined ? current?.apiKey : pickString(patch.apiKey, undefined);
  if (apiKey) next.apiKey = apiKey;

  next.updatedAt = Date.now();
  await writeSettings(next);
  return next;
}

export async function clearAiSettings(): Promise<void> {
  try {
    await fs.unlink(FILE);
  } catch {
    // nothing to clear
  }
}

function pickString(next: string | undefined, fallback: string | undefined): string | undefined {
  if (next === undefined) return fallback;
  const trimmed = next.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickLanguage(
  next: AiLanguage | undefined,
  fallback: AiLanguage | undefined,
): AiLanguage | undefined {
  if (next === "fa" || next === "en") return next;
  return fallback;
}
