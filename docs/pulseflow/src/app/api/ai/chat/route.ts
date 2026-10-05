import { NextResponse } from "next/server";
import { buildChatMessages, type AiSection, type ChatMessage } from "@/lib/ai-context";
import { resolveSettings } from "@/lib/ai-providers";
import { streamChat } from "@/lib/server/ai-provider";
import { getAiSettings } from "@/lib/server/ai-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  section?: AiSection;
  context?: string;
  question?: string;
  history?: ChatMessage[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const resolved = resolveSettings(await getAiSettings());
  if (!resolved.apiKey) {
    return NextResponse.json({ error: "No API key configured" }, { status: 400 });
  }

  const section = body.section ?? "problems";
  const messages = buildChatMessages(
    section,
    typeof body.context === "string" ? body.context : "",
    body.question,
    resolved.language,
    body.history,
  );

  const iterator = streamChat(resolved, messages, request.signal);

  // Resolve the first chunk before committing to a 200 stream, so auth/network
  // failures surface as a clean JSON error with a real status code.
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let next = first;
        while (!next.done) {
          if (next.value) controller.enqueue(encoder.encode(next.value));
          next = await iterator.next();
        }
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(encoder.encode(`\n\n[stopped: ${errorMessage(error)}]`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      void iterator.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
