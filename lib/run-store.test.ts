import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { completeStep, createRun, failRun, nextIncompleteStep, startStep } from "./run-store.ts";

test("a completed step stores output and creates exactly one continuation", () => {
  const db = openDatabase(":memory:");
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: "first", input: null } });
    const first = nextIncompleteStep(db, runId)!;
    startStep(db, first);
    const outcome = { output: { answer: 42 }, nextStep: { type: "second", input: { answer: 42 } } };
    completeStep(db, first, outcome);
    assert.deepEqual(JSON.parse(db.prepare("SELECT output_json FROM run_steps WHERE id = ?").get(first.id)!.output_json as string), { answer: 42 });
    assert.throws(() => completeStep(db, first, outcome), /no longer running/);
    const second = nextIncompleteStep(db, runId)!;
    assert.equal(second.type, "second");
    assert.equal(second.step_number, 2);
    assert.equal(second.input_json, JSON.stringify(outcome.output));
    // Re-entering a running step represents retrying after a process interruption.
    startStep(db, second);
    startStep(db, second);
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
    const first = nextIncompleteStep(db, runId)!;
    startStep(db, first);
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
    failRun(db, runId, "Cannot continue");
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status, "failed");
    assert.equal(db.prepare("SELECT error FROM run_steps WHERE id = ?").get(first.id)?.error, "Cannot continue");
  } finally {
    db.close();
  }
});
