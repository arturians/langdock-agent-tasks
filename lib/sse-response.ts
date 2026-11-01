import { subscribeToRuns } from "./run-notifications.ts";

/** Subscribe before reading; snapshots recover missed/coalesced notifications. */
export function snapshotStream<T>(options: {
  request: Request;
  userId: string;
  runId?: string;
  read: () => T;
  close: () => void;
  finished?: (snapshot: T) => boolean;
  reconcileMs?: number;
}): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let stopped = false;
      let previous = "";
      let timer: ReturnType<typeof setInterval> | undefined = undefined;
      let unsubscribe = () => {};
      const stop = (cancelled = false) => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        unsubscribe();
        options.request.signal.removeEventListener("abort", abort);
        options.close();
        if (!cancelled) controller.close();
      };
      const abort = () => stop();
      cleanup = () => stop(true);
      const send = () => {
        if (stopped) return;
        try {
          const snapshot = options.read();
          const data = JSON.stringify(snapshot);
          if (data !== previous) {
            // Bound buffered data for disconnected/slow observers; reconnect sends a snapshot.
            if (controller.desiredSize !== null && controller.desiredSize <= 0 && previous) {
              stop();
              return;
            }
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            previous = data;
          }
          if (options.finished?.(snapshot)) stop();
        } catch {
          stop();
        }
      };
      unsubscribe = subscribeToRuns(options.userId, (runId) => {
        if (!options.runId || options.runId === runId) send();
      });
      options.request.signal.addEventListener("abort", abort, { once: true });
      if (options.request.signal.aborted) { stop(); return; }
      timer = setInterval(() => {
        send();
        if (!stopped) {
          if (controller.desiredSize !== null && controller.desiredSize <= 0) stop();
          else controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, options.reconcileMs ?? 15_000);
      send();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
  } });
}
