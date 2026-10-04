import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { listSessions, saveSession } from "@/lib/server/session-store";
import type { SavedSession } from "@/lib/session-history";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await listSessions();
  // List view omits the full report payload to keep the response small.
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      savedAt: s.savedAt,
      label: s.label,
      mode: s.mode,
      isolateName: s.isolateName,
      stats: s.stats,
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SavedSession>;
  if (!body.stats) {
    return NextResponse.json({ error: "stats are required" }, { status: 400 });
  }
  const entry: SavedSession = {
    id: randomUUID(),
    savedAt: Date.now(),
    label: body.label,
    mode: body.mode,
    isolateName: body.isolateName,
    stats: body.stats,
    report: body.report ?? null,
  };
  await saveSession(entry);
  return NextResponse.json({ id: entry.id }, { status: 201 });
}
