import type { DatabaseSync } from "node:sqlite";
import { stepRegistry } from "./agent/processors.ts";
import type { AgentEvent, RunStatus } from "./types.ts";

export type RunProgress = { status: RunStatus; events: AgentEvent[] };

/** A read transaction gives the observer a consistent snapshot of run and steps. */
export function readUserProgress(db: DatabaseSync, userId: string, runId: string): RunProgress | null {
  db.exec("BEGIN");
  try {
    const run = db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, userId);
    if (!run) return null;
    const at = (value: unknown) => new Date(value as number).toISOString();
    const events: AgentEvent[] = [{ type: "run.started", runId, prompt: run.prompt as string, occurredAt: at(run.created_at) }];
    for (const step of db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_number").all(runId)) {
      if (step.started_at === null) continue;
      const title = stepRegistry.get(step.type as string).title;
      events.push({ type: "step.started", runId, step: step.step_number as number, title, occurredAt: at(step.started_at) });
      if (step.status === "completed") events.push({ type: "step.completed", runId, step: step.step_number as number, title, occurredAt: at(step.finished_at) });
    }
    if (run.status === "completed") events.push({ type: "run.completed", runId, result: run.result as string, occurredAt: at(run.finished_at) });
    if (run.status === "failed") events.push({ type: "run.failed", runId, error: run.error as string, occurredAt: at(run.finished_at) });
    return { status: run.status as RunStatus, events };
  } finally {
    db.exec("COMMIT");
  }
}
