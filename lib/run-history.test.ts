import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { completeStep, createRun, failStep, listUserRuns, claimStep } from "./run-store.ts";
import { readUserProgress } from "./run-progress.ts";
import { restoredSelection, selectionKey } from "./run-selection.ts";

test("history is owner-scoped and ordered newest first with no output or lease data", () => {
  const db = openDatabase(":memory:");
  try {
    const input = { prompt: "Test", firstStep: { type: "UnderstandRequestProcessor", input: { prompt: "Test" } } };
    const old = createRun(db, { ...input, userId: "a" });
    const recent = createRun(db, { ...input, userId: "a" });
    const foreign = createRun(db, { ...input, userId: "b" });
    db.prepare("UPDATE runs SET created_at = 100 WHERE id = ?").run(old);
    db.prepare("UPDATE runs SET created_at = 200 WHERE id = ?").run(recent);
    const runs = listUserRuns(db, "a").runs;
    assert.deepEqual(runs.map(run => run.id), [recent, old]);
    assert.equal(listUserRuns(db, "b").runs[0].id, foreign);
    assert.deepEqual(listUserRuns(db, "unknown").runs, []);
    assert.equal("lease_token" in runs[0], false);
    assert.equal(readUserProgress(db, "a", foreign), null);
    assert.equal(restoredSelection(runs, old), old);
    assert.equal(restoredSelection(runs, foreign), recent);
    assert.equal(restoredSelection([], old), null);
    assert.notEqual(selectionKey("a"), selectionKey("b"));
  } finally { db.close(); }
});

test("completed and failed tasks retain inspectable results and error events", () => {
  const db = openDatabase(":memory:");
  try {
    const input = { userId: "a", prompt: "Test", firstStep: { type: "ProduceResponseProcessor", input: { prompt: "Test" } } };
    const completedId = createRun(db, input);
    const completedStep = claimStep(db, 15_000)!;
    completeStep(db, completedStep, { output: { result: "Saved result" }, nextStep: null, result: "Saved result" });
    assert.deepEqual(readUserProgress(db, "a", completedId)?.events.at(-1), {
      type: "run.completed", runId: completedId, result: "Saved result",
      occurredAt: new Date(db.prepare("SELECT finished_at FROM runs WHERE id = ?").get(completedId)!.finished_at as number).toISOString(),
    });
    const failedId = createRun(db, input);
    const failedStep = claimStep(db, 15_000)!;
    failStep(db, failedStep, "Saved failure");
    const event = readUserProgress(db, "a", failedId)?.events.at(-1);
    assert.ok(event?.type === "run.failed");
    assert.equal(event.error, "Saved failure");
    assert.deepEqual(new Set(listUserRuns(db, "a").runs.map(run => run.status)), new Set(["completed", "failed"]));
  } finally { db.close(); }
});
