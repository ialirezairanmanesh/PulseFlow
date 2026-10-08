import { NextResponse } from "next/server";
import { mirrorHealthUrl } from "@/lib/device-mirror";

export const dynamic = "force-dynamic";

/**
 * Same-origin probe for the ws-scrcpy sidecar.
 * Browser fetch to :3848 is cross-origin and blocked (no CORS on Express).
 */
export async function GET() {
  try {
    const res = await fetch(mirrorHealthUrl(), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    // ws-scrcpy serves 200 on /; offline stub serves 503.
    if (res.ok) {
      return NextResponse.json({ online: true }, { status: 200 });
    }
    return NextResponse.json(
      { online: false, upstream: res.status },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ online: false }, { status: 503 });
  }
}
