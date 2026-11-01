import { firstStep, runAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/types";
import { requestUserId } from "@/lib/user-id";
import { openDatabase } from "@/lib/db";
import { createRun } from "@/lib/run-store";

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
  let runId: string;
  try {
    runId = createRun(db, { userId, prompt, firstStep: firstStep(prompt) });
  } catch (error) {
    db.close();
    throw error;
  }
  let connected = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AgentEvent) => {
        if (connected && !request.signal.aborted) controller.enqueue(serialize(event));
      };

      void runAgent({ db, runId, prompt, signal: request.signal, emit })
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
        .finally(() => {
          db.close();
          if (connected) controller.close();
        });
    },
    cancel() {
      connected = false;
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
