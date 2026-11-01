import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StepDefinition = { type: string; input: JsonValue };

export function ensureUser(db: DatabaseSync, userId: string, now = Date.now()): void {
  db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING")
    .run(userId, now);
}

/** All future task reads must be scoped by both run ID and user ID. */
export function findUserRun(db: DatabaseSync, userId: string, runId: string) {
  return db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, userId);
}

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
    ensureUser(db, input.userId, now);
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
