import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { encodeRunCursor } from "./run-pagination.ts";
import type { RunCursor } from "./run-pagination.ts";
import type { RunPage, RunSummary } from "./types.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StepDefinition = { type: string; input: JsonValue };

export type StoredStep = {
  id: string;
  run_id: string;
  user_id: string;
  step_number: number;
  type: string;
  input_json: string;
  idempotency_key: string;
  status: "pending" | "running" | "completed" | "failed";
};

export type StepResult = {
  output: JsonValue;
} & (
  | { nextStep: StepDefinition; result?: never }
  | { nextStep: null; result: string }
);

export class LostLeaseError extends Error {
  constructor() { super("Step lease is no longer owned by this worker."); }
}

export type ClaimedStep = StoredStep & { status: "running"; lease_token: string; lease_expires_at: number };

function assertLease(db: DatabaseSync, step: ClaimedStep): void {
  const owned = db.prepare(`SELECT s.id FROM run_steps s JOIN runs r ON r.id = s.run_id
    WHERE s.id = ? AND s.run_id = ? AND s.user_id = ? AND s.status = 'running'
      AND s.lease_token = ? AND s.lease_expires_at > ? AND r.status = 'running'`)
    .get(step.id, step.run_id, step.user_id, step.lease_token, Date.now());
  if (!owned) throw new LostLeaseError();
}

/** Claim exactly one runnable step; no run-wide lease is held between steps. */
export function claimStep(db: DatabaseSync, leaseMs: number): ClaimedStep | undefined {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Invalid lease duration.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now();
    const step = db.prepare(`UPDATE run_steps SET status = 'running', lease_token = ?, lease_expires_at = ?,
      attempts = attempts + 1, started_at = ?, finished_at = NULL, error = NULL
      WHERE id = (SELECT s.id FROM run_steps s JOIN runs r ON r.id = s.run_id
        WHERE r.status IN ('queued', 'running') AND s.available_at <= ?
          AND (s.status = 'pending' OR (s.status = 'running' AND s.lease_expires_at <= ?))
        ORDER BY s.available_at, s.created_at, s.id LIMIT 1)
      RETURNING *`).get(randomUUID(), now + leaseMs, now, now, now) as ClaimedStep | undefined;
    if (step) db.prepare(`UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?),
      updated_at = ? WHERE id = ?`).run(now, now, step.run_id);
    db.exec("COMMIT");
    return step;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function renewLease(db: DatabaseSync, step: ClaimedStep, leaseMs: number): void {
  const now = Date.now();
  const updated = db.prepare(`UPDATE run_steps SET lease_expires_at = ?
    WHERE id = ? AND status = 'running' AND lease_token = ? AND lease_expires_at > ?`)
    .run(now + leaseMs, step.id, step.lease_token, now);
  if (updated.changes !== 1) throw new LostLeaseError();
}

export function releaseLease(db: DatabaseSync, step: ClaimedStep): void {
  db.prepare(`UPDATE run_steps SET status = 'pending', lease_token = NULL, lease_expires_at = NULL
    WHERE id = ? AND status = 'running' AND lease_token = ?`).run(step.id, step.lease_token);
}

export function nextIncompleteStep(db: DatabaseSync, runId: string): StoredStep | undefined {
  return db.prepare(`SELECT * FROM run_steps WHERE run_id = ? AND status != 'completed'
    ORDER BY step_number LIMIT 1`).get(runId) as StoredStep | undefined;
}

/** Commit output and continuation together; only the current step owner may write. */
export function completeStep(db: DatabaseSync, step: ClaimedStep, outcome: StepResult, nextDelayMs = 0): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease(db, step);
    db.prepare(`UPDATE run_steps SET status = 'completed', output_json = ?, finished_at = ?,
      lease_token = NULL, lease_expires_at = NULL WHERE id = ?`)
      .run(JSON.stringify(outcome.output), now, step.id);
    if (outcome.nextStep) {
      const id = randomUUID();
      db.prepare(`INSERT INTO run_steps
        (id, run_id, user_id, step_number, type, input_json, idempotency_key, created_at, available_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(id, step.run_id, step.user_id, step.step_number + 1,
        outcome.nextStep.type, JSON.stringify(outcome.nextStep.input), id, now, now + nextDelayMs);
    }
    db.prepare(`UPDATE runs SET updated_at = ?, status = ?, result = ?, finished_at = ? WHERE id = ?`)
      .run(now, outcome.nextStep ? "running" : "completed", outcome.nextStep ? null : outcome.result,
        outcome.nextStep ? null : now, step.run_id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function failStep(db: DatabaseSync, step: ClaimedStep, error: string): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertLease(db, step);
    db.prepare(`UPDATE run_steps SET status = 'failed', error = ?, finished_at = ?,
      lease_token = NULL, lease_expires_at = NULL WHERE id = ?`).run(error, now, step.id);
    db.prepare(`UPDATE runs SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
      WHERE id = ?`).run(error, now, now, step.run_id);
    db.exec("COMMIT");
  } catch (failure) { db.exec("ROLLBACK"); throw failure; }
}

export function ensureUser(db: DatabaseSync, userId: string, now = Date.now()): void {
  db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING")
    .run(userId, now);
}

/** All future task reads must be scoped by both run ID and user ID. */
export function findUserRun(db: DatabaseSync, userId: string, runId: string) {
  return db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, userId);
}

function cursorFor(run: RunSummary): string {
  return encodeRunCursor({ createdAt: run.created_at, id: run.id });
}

export function listUserRuns(db: DatabaseSync, userId: string, options: { limit: number; cursor?: RunCursor } = { limit: 20 }): RunPage {
  const { limit, cursor } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid page size.");
  const rows = (cursor
    ? db.prepare(`SELECT id, prompt, status, created_at, updated_at FROM runs WHERE user_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db.prepare(`SELECT id, prompt, status, created_at, updated_at FROM runs WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, limit + 1)) as RunSummary[];
  const runs = rows.slice(0, limit);
  const endCursor = runs.length ? cursorFor(runs[runs.length - 1]) : null;
  return { runs, endCursor, nextCursor: rows.length > limit ? endCursor : null };
}

/** Live snapshots cover exactly the loaded range, plus newly created tasks above it. */
export function readUserRunWindow(db: DatabaseSync, userId: string, limit: number, through?: RunCursor): RunPage {
  if (!through) return listUserRuns(db, userId, { limit });
  db.exec("BEGIN");
  try {
    const runs = db.prepare(`SELECT id, prompt, status, created_at, updated_at FROM runs WHERE user_id = ?
      AND (created_at > ? OR (created_at = ? AND id >= ?))
      ORDER BY created_at DESC, id DESC`).all(userId, through.createdAt, through.createdAt, through.id) as RunSummary[];
    const endCursor = runs.length ? cursorFor(runs[runs.length - 1]) : null;
    const older = db.prepare(`SELECT id FROM runs WHERE user_id = ?
      AND (created_at < ? OR (created_at = ? AND id < ?)) LIMIT 1`)
      .get(userId, through.createdAt, through.createdAt, through.id);
    return { runs, endCursor, nextCursor: older ? encodeRunCursor(through) : null };
  } finally { db.exec("COMMIT"); }
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
      INSERT INTO run_steps (id, run_id, user_id, step_number, type, input_json, idempotency_key, created_at, available_at, status)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'pending')
    `).run(stepId, runId, input.userId, input.firstStep.type, JSON.stringify(input.firstStep.input), stepId, now, now);
    db.exec("COMMIT");
    return runId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
