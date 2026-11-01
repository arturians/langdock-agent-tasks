import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RunSummary } from "./types.ts";

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

export class LostLeaseError extends Error {
  constructor() { super("Run lease is no longer owned by this worker."); }
}

export type ClaimedRun = { id: string; prompt: string; lease_token: string };

function assertLease(db: DatabaseSync, runId: string, token: string | null): void {
  const owned = db.prepare(`SELECT id FROM runs WHERE id = ? AND
    ((? IS NULL AND lease_token IS NULL) OR (lease_token = ? AND lease_expires_at > ?))`)
    .get(runId, token, token, Date.now());
  if (!owned) throw new LostLeaseError();
}

/** A single UPDATE selects and claims work atomically across worker processes. */
export function claimRun(db: DatabaseSync, leaseMs: number): ClaimedRun | undefined {
  const now = Date.now();
  return db.prepare(`UPDATE runs SET status = 'running', lease_token = ?, lease_expires_at = ?,
    started_at = COALESCE(started_at, ?), updated_at = ?
    WHERE id = (SELECT id FROM runs WHERE status = 'queued'
      OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
      ORDER BY created_at, id LIMIT 1)
    RETURNING id, prompt, lease_token`).get(randomUUID(), now + leaseMs, now, now, now) as ClaimedRun | undefined;
}

export function renewLease(db: DatabaseSync, runId: string, token: string, leaseMs: number): void {
  const now = Date.now();
  const updated = db.prepare(`UPDATE runs SET lease_expires_at = ?
    WHERE id = ? AND status = 'running' AND lease_token = ? AND lease_expires_at > ?`)
    .run(now + leaseMs, runId, token, now);
  if (updated.changes !== 1) throw new LostLeaseError();
}

export function releaseLease(db: DatabaseSync, runId: string, token: string): void {
  db.prepare(`UPDATE runs SET lease_token = NULL, lease_expires_at = NULL
    WHERE id = ? AND status = 'running' AND lease_token = ?`).run(runId, token);
}

export function nextIncompleteStep(db: DatabaseSync, runId: string): StoredStep | undefined {
  return db.prepare(`SELECT * FROM run_steps WHERE run_id = ? AND status != 'completed'
    ORDER BY step_number LIMIT 1`).get(runId) as StoredStep | undefined;
}

export function startStep(db: DatabaseSync, step: StoredStep, leaseToken: string | null = null): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease(db, step.run_id, leaseToken);
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
export function completeStep(db: DatabaseSync, step: StoredStep, outcome: StepResult, leaseToken: string | null = null): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease(db, step.run_id, leaseToken);
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
    if (!outcome.nextStep) releaseFinishedLease(db, step.run_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function releaseFinishedLease(db: DatabaseSync, runId: string): void {
  db.prepare("UPDATE runs SET lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(runId);
}

export function failRun(db: DatabaseSync, runId: string, error: string, leaseToken: string | null = null): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease(db, runId, leaseToken);
    db.prepare(`UPDATE run_steps SET status = 'failed', error = ?, finished_at = ?
      WHERE run_id = ? AND status = 'running'`).run(error, now, runId);
    db.prepare(`UPDATE runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`).run(error, now, now, runId);
    releaseFinishedLease(db, runId);
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

export function listUserRuns(db: DatabaseSync, userId: string): RunSummary[] {
  return db.prepare(`SELECT id, prompt, status, created_at, updated_at FROM runs
    WHERE user_id = ? ORDER BY created_at DESC, id DESC`).all(userId) as RunSummary[];
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
