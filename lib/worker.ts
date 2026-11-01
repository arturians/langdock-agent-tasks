import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { WorkerNotifier } from "./run-notifications.ts";
import { StepExecutionService } from "./agent/step-execution-service.ts";
import { stepRegistry } from "./agent/processors.ts";
import { claimStep, LostLeaseError, releaseLease, renewLease } from "./run-store.ts";

/** One step per claim; every successor competes in the shared queue. */
export async function workOnce(db: DatabaseSync, signal: AbortSignal, leaseMs = 15_000): Promise<boolean> {
  signal.throwIfAborted();
  const step = claimStep(db, leaseMs);
  if (!step) return false;
  const notifier = new WorkerNotifier();
  const service = new StepExecutionService(db, stepRegistry,
    Number(process.env.AGENT_STEP_DELAY_MS ?? 2500), Number(process.env.AGENT_STEP_TRANSITION_DELAY_MS ?? 600));
  const update = { userId: step.user_id, runId: step.run_id, stepId: step.id };
  const controller = new AbortController();
  const stop = () => controller.abort(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  const heartbeat = setInterval(() => {
    try {
      renewLease(db, step, leaseMs);
    } catch (error) {
      controller.abort(error);
    }
  }, Math.max(1, Math.floor(leaseMs / 3)));
  try {
    // Claim has already committed the step start before this notification.
    notifier.notify(update);
    await service.execute(step, controller.signal, () => notifier.notify(update));
  } catch (error) {
    if (!controller.signal.aborted && !(error instanceof LostLeaseError)) service.recordFailure(step, error);
    throw error;
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", stop);
    releaseLease(db, step);
    notifier.notify(update);
    await notifier.flush();
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
