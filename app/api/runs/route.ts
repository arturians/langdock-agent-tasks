import { runAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(event: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
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
