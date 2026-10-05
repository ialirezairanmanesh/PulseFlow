import { NextResponse } from "next/server";
import { PROVIDERS, publicAiSettings, type AiSettings } from "@/lib/ai-providers";
import { clearAiSettings, getAiSettings, saveAiSettings } from "@/lib/server/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getAiSettings();
  return NextResponse.json({ ...publicAiSettings(settings), providers: PROVIDERS });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<AiSettings>;
  const saved = await saveAiSettings(body);
  return NextResponse.json({ ...publicAiSettings(saved), providers: PROVIDERS });
}

export async function DELETE() {
  await clearAiSettings();
  return NextResponse.json({ ...publicAiSettings(null), providers: PROVIDERS });
}
