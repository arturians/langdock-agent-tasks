import { runAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/types";
import { requestUserId } from "@/lib/user-id";
import { openDatabase } from "@/lib/db";
import { ensureUser } from "@/lib/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(event: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) {
    return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  const db = openDatabase();
  try {
    ensureUser(db, userId);
  } finally {
    db.close();
  }

  const runId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AgentEvent) => controller.enqueue(serialize(event));

      void runAgent({ runId, prompt, signal: request.signal, emit })
        .catch((error: unknown) => {
          if (!request.signal.aborted) {
            emit({
              type: "run.failed",
              runId,
              error: error instanceof Error ? error.message : "Unknown agent error",
              occurredAt: new Date().toISOString(),
            });
          }
        })
        .finally(() => controller.close());
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
