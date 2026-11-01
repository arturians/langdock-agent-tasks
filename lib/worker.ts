import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { runAgent } from "./agent.ts";
import { claimRun, releaseLease, renewLease } from "./run-store.ts";

/** One run at a time per process; multiple workers coordinate through SQLite. */
export async function workOnce(db: DatabaseSync, signal: AbortSignal, leaseMs = 15_000): Promise<boolean> {
  signal.throwIfAborted();
  const run = claimRun(db, leaseMs);
  if (!run) return false;
  const controller = new AbortController();
  const stop = () => controller.abort(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  const heartbeat = setInterval(() => {
    try {
      renewLease(db, run.id, run.lease_token, leaseMs);
    } catch (error) {
      controller.abort(error);
    }
  }, Math.max(1, Math.floor(leaseMs / 3)));
  try {
    await runAgent({
      db, runId: run.id, prompt: run.prompt, leaseToken: run.lease_token,
      signal: controller.signal, emit: () => {},
    });
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", stop);
    releaseLease(db, run.id, run.lease_token);
  }
  return true;
}

export async function runWorker(db: DatabaseSync, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      if (!await workOnce(db, signal)) await delay(500, undefined, { signal });
    } catch (error) {
      if (signal.aborted) return;
      console.error("Worker run failed:", error);
      await delay(500, undefined, { signal }).catch(() => {});
    }
  }
}
