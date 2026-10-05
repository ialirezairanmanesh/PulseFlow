import { NextResponse } from "next/server";
import { resolveSettings } from "@/lib/ai-providers";
import { streamChat } from "@/lib/server/ai-provider";
import { getAiSettings } from "@/lib/server/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A tiny ping so the settings page can validate the key/model without a full answer. */
export async function POST() {
  const resolved = resolveSettings(await getAiSettings());
  if (!resolved.apiKey) {
    return NextResponse.json({ ok: false, error: "No API key configured" }, { status: 400 });
  }

  try {
    let text = "";
    for await (const delta of streamChat(resolved, [
      { role: "user", content: "Reply with the single word: ok" },
    ])) {
      text += delta;
      if (text.length > 40) break;
    }
    return NextResponse.json({ ok: true, sample: text.trim().slice(0, 60) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
