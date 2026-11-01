import type { DatabaseSync } from "node:sqlite";
import { subscribeToRuns } from "./run-notifications.ts";
import { runChangeCursor } from "./run-store.ts";
import type { RunHistoryEvent, RunSummary } from "./types.ts";

export function parseChangeCursor(raw: string): number {
  if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Invalid change cursor.");
  return Number(raw);
}

export function readRunChanges(db: DatabaseSync, userId: string, after: number): RunHistoryEvent[] {
  const rows = db.prepare(`SELECT seq, run_id AS id, prompt, status, created_at, updated_at, seq AS revision
    FROM run_changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 100`).all(userId, after);
  return rows.map(row => ({ type: "run.updated", cursor: String(row.seq), run: {
    id: row.id, prompt: row.prompt, status: row.status, created_at: row.created_at,
    updated_at: row.updated_at, revision: row.revision,
  } as RunSummary }));
}

/** Replay durable single-run changes; never enumerate the user's task history. */
export function runChangeStream(options: {
  db: DatabaseSync; request: Request; userId: string; after?: number; reconcileMs?: number;
}): Response {
  let cleanup = () => {};
  let pump = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor = options.after ?? Number(runChangeCursor(options.db, options.userId));
      let pending: RunHistoryEvent[] = [{ type: "ready", cursor: String(cursor) }];
      let closed = false;
      const encoder = new TextEncoder();
      const stop = (cancelled = false) => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        unsubscribe();
        options.request.signal.removeEventListener("abort", abort);
        options.db.close();
        if (!cancelled) controller.close();
      };
      const abort = () => stop();
      cleanup = () => stop(true);
      pump = () => {
        if (closed) return;
        try {
          while ((controller.desiredSize ?? 0) > 0) {
            if (!pending.length) pending = readRunChanges(options.db, options.userId, cursor);
            const event = pending.shift();
            if (!event) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            cursor = Number(event.cursor);
          }
        } catch { stop(); }
      };
      const unsubscribe = subscribeToRuns(options.userId, () => pump());
      const timer = setInterval(() => {
        pump();
        if (!closed && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, options.reconcileMs ?? 15_000);
      options.request.signal.addEventListener("abort", abort, { once: true });
      if (options.request.signal.aborted) stop(); else pump();
    },
    pull() { pump(); },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
  } });
}
