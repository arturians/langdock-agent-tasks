import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StepDefinition = { type: string; input: JsonValue };

/** Persist acceptance and only the first step; later steps are produced at runtime. */
export function createRun(db: DatabaseSync, input: {
  userId: string;
  prompt: string;
  firstStep: StepDefinition;
}): string {
  const runId = randomUUID();
  const stepId = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING")
      .run(input.userId, now);
    db.prepare("INSERT INTO runs (id, user_id, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(runId, input.userId, input.prompt, now, now);
    db.prepare(`
      INSERT INTO run_steps (id, run_id, step_number, type, input_json, idempotency_key, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(stepId, runId, input.firstStep.type, JSON.stringify(input.firstStep.input), stepId, now);
    db.exec("COMMIT");
    return runId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
