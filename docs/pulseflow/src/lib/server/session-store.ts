import { promises as fs } from "node:fs";
import path from "node:path";
import type { SavedSession } from "@/lib/session-history";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "sessions.json");
const MAX_SESSIONS = 50;

export async function listSessions(): Promise<SavedSession[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as SavedSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSessions(sessions: SavedSession[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(sessions, null, 2), "utf8");
}

export async function saveSession(session: SavedSession): Promise<void> {
  const sessions = await listSessions();
  const next = [...sessions.filter((s) => s.id !== session.id), session]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_SESSIONS);
  await writeSessions(next);
}

export async function getSession(id: string): Promise<SavedSession | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.id === id) ?? null;
}

export async function deleteSession(id: string): Promise<boolean> {
  const sessions = await listSessions();
  const next = sessions.filter((s) => s.id !== id);
  if (next.length === sessions.length) return false;
  await writeSessions(next);
  return true;
}
