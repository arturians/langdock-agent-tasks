import assert from "node:assert/strict";
import { test } from "node:test";
import { readSnapshots } from "./read-sse.ts";
import { publishRunUpdate } from "./run-notifications.ts";
import { snapshotStream } from "./sse-response.ts";

function responseStream(chunks: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("SSE reader handles chunk boundaries, comments and multiple snapshots", async () => {
  const snapshots = [];
  for await (const value of readSnapshots(responseStream([': heartbeat\n\nda', 'ta: {"value":', '1}\n\ndata: {"value":2}\n\n']))) snapshots.push(value);
  assert.deepEqual(snapshots, [{ value: 1 }, { value: 2 }]);
});

test("SSE pushes only owned task updates, closes on terminal state and releases resources", async () => {
  const controller = new AbortController();
  let value = 0;
  let closed = 0;
  const snapshots = readSnapshots<{ value: number; notification?: { userId: string; runId: string; stepId: string } }>(snapshotStream({
    request: new Request("http://localhost", { signal: controller.signal }), userId: "a", runId: "run-a",
    read: () => ({ value }), close: () => { closed++; }, finished: snapshot => snapshot.value === 2,
  }));
  assert.equal((await snapshots.next()).value?.value, 0);
  value = 1;
  publishRunUpdate("b", "run-a");
  publishRunUpdate("a", "run-b");
  publishRunUpdate("a", "run-a", "step-1");
  const update = (await snapshots.next()).value!;
  assert.equal(update.value, 1);
  assert.deepEqual(update.notification, { userId: "a", runId: "run-a", stepId: "step-1" });
  value = 2;
  publishRunUpdate("a", "run-a");
  assert.equal((await snapshots.next()).value?.value, 2);
  assert.equal((await snapshots.next()).done, true);
  assert.equal(closed, 1);
  controller.abort();
  assert.equal(closed, 1);
});

test("SSE reconciles missed notifications and starts a reconnect from current state", async () => {
  let value = 0;
  const response = snapshotStream({ request: new Request("http://localhost"), userId: "a",
    read: () => ({ value }), close: () => {}, reconcileMs: 10,
  });
  const snapshots = readSnapshots<{ value: number }>(response);
  assert.equal((await snapshots.next()).value?.value, 0);
  value = 42;
  assert.equal((await snapshots.next()).value?.value, 42);
  await snapshots.return(undefined);
  const reconnect = readSnapshots<{ value: number }>(snapshotStream({ request: new Request("http://localhost"), userId: "a",
    read: () => ({ value }), close: () => {}, finished: () => true,
  }));
  assert.equal((await reconnect.next()).value?.value, 42);
  await reconnect.return(undefined);
});
