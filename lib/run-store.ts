import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StepDefinition = { type: string; input: JsonValue };

export type StoredStep = {
  id: string;
  run_id: string;
  step_number: number;
  type: string;
  input_json: string;
  status: "pending" | "running" | "completed" | "failed";
};

export type StepResult = {
  output: JsonValue;
} & (
  | { nextStep: StepDefinition; result?: never }
  | { nextStep: null; result: string }
);

export function nextIncompleteStep(db: DatabaseSync, runId: string): StoredStep | undefined {
  return db.prepare(`SELECT * FROM run_steps WHERE run_id = ? AND status != 'completed'
    ORDER BY step_number LIMIT 1`).get(runId) as StoredStep | undefined;
}

export function startStep(db: DatabaseSync, step: StoredStep): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db.prepare(`UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?),
      updated_at = ? WHERE id = ? AND status IN ('queued', 'running')`).run(now, now, step.run_id);
    if (run.changes !== 1) throw new Error("Run is not executable.");
    const updated = db.prepare(`UPDATE run_steps SET status = 'running', attempts = attempts + 1,
      started_at = ?, finished_at = NULL, error = NULL
      WHERE id = ? AND run_id = ? AND status IN ('pending', 'running')`).run(now, step.id, step.run_id);
    if (updated.changes !== 1) throw new Error("Step is not executable.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Commit output and continuation together, never leaving a gap between steps. */
export function completeStep(db: DatabaseSync, step: StoredStep, outcome: StepResult): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const updated = db.prepare(`UPDATE run_steps SET status = 'completed', output_json = ?, finished_at = ?
      WHERE id = ? AND run_id = ? AND status = 'running'`).run(JSON.stringify(outcome.output), now, step.id, step.run_id);
    if (updated.changes !== 1) throw new Error("Step is no longer running.");
    if (outcome.nextStep) {
      const id = randomUUID();
      db.prepare(`INSERT INTO run_steps
        (id, run_id, step_number, type, input_json, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, step.run_id, step.step_number + 1,
        outcome.nextStep.type, JSON.stringify(outcome.nextStep.input), id, now);
    }
    const run = db.prepare(`UPDATE runs SET updated_at = ?, status = ?, result = ?, finished_at = ?
      WHERE id = ? AND status = 'running'`).run(now, outcome.nextStep ? "running" : "completed",
      outcome.nextStep ? null : outcome.result, outcome.nextStep ? null : now, step.run_id);
    if (run.changes !== 1) throw new Error("Run is no longer running.");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function failRun(db: DatabaseSync, runId: string, error: string): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE run_steps SET status = 'failed', error = ?, finished_at = ?
      WHERE run_id = ? AND status = 'running'`).run(error, now, runId);
    db.prepare(`UPDATE runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`).run(error, now, now, runId);
    db.exec("COMMIT");
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
}

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
