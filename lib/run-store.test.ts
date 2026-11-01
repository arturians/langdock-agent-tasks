import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "./db.ts";
import { completeStep, createRun, failStep, nextIncompleteStep, claimStep, releaseLease } from "./run-store.ts";

test("a completed step stores output and creates exactly one continuation", () => {
  const db = openDatabase(":memory:");
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: "first", input: null } });
    const first = claimStep(db, 15_000)!;
    const outcome = { output: { answer: 42 }, nextStep: { type: "second", input: { answer: 42 } } };
    completeStep(db, first, outcome);
    assert.deepEqual(JSON.parse(db.prepare("SELECT output_json FROM run_steps WHERE id = ?").get(first.id)!.output_json as string), { answer: 42 });
    assert.throws(() => completeStep(db, first, outcome), /no longer owned/);
    let second = claimStep(db, 15_000)!;
    assert.equal(second.type, "second");
    assert.equal(second.step_number, 2);
    assert.equal(second.input_json, JSON.stringify(outcome.output));
    // Re-entering a running step represents retrying after a process interruption.
    releaseLease(db, second);
    second = claimStep(db, 15_000)!;
    assert.equal(db.prepare("SELECT attempts FROM run_steps WHERE id = ?").get(second.id)?.attempts, 2);
    completeStep(db, second, { output: { answer: "done" }, nextStep: null, result: "done" });
    assert.equal(nextIncompleteStep(db, runId), undefined);
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId)!;
    assert.equal(run.status, "completed");
    assert.equal(run.result, "done");
    assert.ok(run.finished_at);
    assert.equal(db.prepare("SELECT count(*) AS n FROM run_steps").get()?.n, 2);
  } finally {
    db.close();
  }
});

test("failure creating the next step rolls back current output and completion", () => {
  const db = openDatabase(":memory:");
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: "first", input: null } });
    const first = claimStep(db, 15_000)!;
    db.exec(`CREATE TRIGGER reject_continuation BEFORE INSERT ON run_steps
      BEGIN SELECT RAISE(ABORT, 'injected continuation failure'); END;`);
    assert.throws(() => completeStep(db, first, {
      output: { value: 1 }, nextStep: { type: "second", input: null },
    }), /injected continuation failure/);
    const stored = db.prepare("SELECT * FROM run_steps WHERE id = ?").get(first.id)!;
    assert.equal(stored.status, "running");
    assert.equal(stored.output_json, null);
    assert.equal(stored.finished_at, null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM run_steps").get()?.n, 1);
    failStep(db, first, "Cannot continue");
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status, "failed");
    assert.equal(db.prepare("SELECT error FROM run_steps WHERE id = ?").get(first.id)?.error, "Cannot continue");
  } finally {
    db.close();
  }
});

test("runs have independent step leases and successors re-enter the queue with inherited ownership", () => {
  const db = openDatabase(":memory:");
  try {
    const a = createRun(db, { userId: "a", prompt: "A", firstStep: { type: "first", input: null } });
    const first = claimStep(db, 15_000)!;
    const b = createRun(db, { userId: "b", prompt: "B", firstStep: { type: "first", input: null } });
    const other = claimStep(db, 15_000)!;
    assert.equal(first.run_id, a);
    assert.equal(other.run_id, b);
    assert.notEqual(first.lease_token, other.lease_token);
    assert.equal(claimStep(db, 15_000), undefined);
    completeStep(db, first, { output: 42, nextStep: { type: "second", input: 42 } }, 60_000);
    assert.equal(claimStep(db, 15_000), undefined); // successor is not ready yet
    const next = nextIncompleteStep(db, a)!;
    assert.equal(next.user_id, "a");
    db.prepare("UPDATE run_steps SET available_at = 0 WHERE id = ?").run(next.id);
    const successor = claimStep(db, 15_000)!;
    assert.equal(successor.id, next.id);
    assert.notEqual(successor.lease_token, first.lease_token);
    // A previous step's lease cannot mutate its successor or fail the run.
    assert.throws(() => failStep(db, first, "late failure"), /no longer owned/);
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(a)?.status, "running");
    completeStep(db, other, { output: "B", nextStep: null, result: "B" });
    completeStep(db, successor, { output: "A", nextStep: null, result: "A" });
  } finally { db.close(); }
});

test("another worker connection can take a successor without reacquiring its run", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "step-handoff-"));
  const firstWorker = openDatabase(path.join(directory, "agent.db"));
  const secondWorker = openDatabase(path.join(directory, "agent.db"));
  try {
    createRun(firstWorker, { userId: "a", prompt: "Handoff", firstStep: { type: "first", input: null } });
    const first = claimStep(firstWorker, 15_000)!;
    assert.equal(claimStep(secondWorker, 15_000), undefined);
    completeStep(firstWorker, first, { output: 42, nextStep: { type: "second", input: 42 } });
    const second = claimStep(secondWorker, 15_000)!;
    assert.equal(second.run_id, first.run_id);
    assert.equal(second.user_id, first.user_id);
    assert.equal(second.step_number, 2);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.lease_token, first.lease_token);
    assert.throws(() => failStep(firstWorker, first, "late error"), /no longer owned/);
    completeStep(secondWorker, second, { output: "done", nextStep: null, result: "done" });
  } finally {
    secondWorker.close(); firstWorker.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
