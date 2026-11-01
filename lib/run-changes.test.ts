import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { claimStep, completeStep, createRun, listUserRuns, runChangeCursor } from "./run-store.ts";
import { parseChangeCursor, readRunChanges, runChangeStream } from "./run-change-stream.ts";
import { readSnapshots } from "./read-sse.ts";
import { publishRunUpdate } from "./run-notifications.ts";
import { applyRunUpdate, mergeRunPages } from "./merge-run-pages.ts";
import type { RunHistoryEvent } from "./types.ts";

function create(db: ReturnType<typeof openDatabase>, userId = "a") {
  return createRun(db, { userId, prompt: "Test", firstStep: { type: "first", input: null } });
}

test("page watermark and transactional journal replay preserve tied-time updates and ownership", () => {
  const db = openDatabase(":memory:");
  try {
    const id = create(db);
    const page = listUserRuns(db, "a");
    const step = claimStep(db, 15_000)!;
    completeStep(db, step, { output: 42, nextStep: null, result: "done" });
    create(db, "b");
    const changes = readRunChanges(db, "a", Number(page.changeCursor));
    assert.equal(changes.length, 2);
    assert.ok(changes.every(change => change.type === "run.updated" && change.run.id === id));
    assert.deepEqual(changes.map(change => change.type === "run.updated" && change.run.status), ["running", "completed"]);
    assert.ok(Number(changes[1].cursor) > Number(changes[0].cursor));
    db.exec("BEGIN");
    createRollbackFixture(db);
    db.exec("ROLLBACK");
    assert.equal(runChangeCursor(db, "a"), changes[1].cursor);
  } finally { db.close(); }
});

function createRollbackFixture(db: ReturnType<typeof openDatabase>) {
  db.exec("UPDATE runs SET updated_at = updated_at + 1 WHERE user_id = 'a'");
}

test("delta stream sends one task, replays without wake-ups and resumes after the last cursor", async () => {
  const db = openDatabase(":memory:");
  for (let i = 0; i < 300; i++) create(db);
  const after = Number(runChangeCursor(db, "a"));
  const iterator = readSnapshots<RunHistoryEvent>(runChangeStream({
    db, userId: "a", after, request: new Request("http://localhost"), reconcileMs: 10,
  }));
  assert.equal((await iterator.next()).value?.type, "ready");
  const id = create(db);
  // Deliberately omit the wake-up: indexed reconciliation must find this change.
  const updated = (await iterator.next()).value!;
  assert.ok(updated.type === "run.updated");
  assert.equal(updated.run.id, id);
  assert.equal("runs" in updated, false);
  assert.ok(JSON.stringify(updated).length < 1000);
  assert.deepEqual(readRunChanges(db, "a", Number(updated.cursor)), []);
  await iterator.return(undefined); // closes the database owned by the stream
});

test("updates do not clobber newer REST rows and replay fixes a load-more race", () => {
  const db = openDatabase(":memory:");
  try {
    const id = create(db);
    let page = listUserRuns(db, "a");
    const initial = page.runs[0];
    const step = claimStep(db, 15_000)!;
    completeStep(db, step, { output: 1, nextStep: null, result: "done" });
    const current = listUserRuns(db, "a").runs[0];
    page = applyRunUpdate(page, current);
    assert.equal(applyRunUpdate(page, initial), page);
    const combined = mergeRunPages(page, { ...page, runs: [initial] });
    assert.equal(combined.runs[0].status, "completed");
    // Capture a stale older page, then deliver its delta before the page is appended.
    const olderId = create(db);
    const newerId = create(db);
    db.prepare("UPDATE runs SET created_at = 10 WHERE id = ?").run(olderId);
    db.prepare("UPDATE runs SET created_at = 20 WHERE id = ?").run(newerId);
    db.prepare("UPDATE run_steps SET available_at = 0 WHERE run_id = ?").run(olderId);
    db.prepare("UPDATE runs SET created_at = 0 WHERE id = ?").run(id);
    const firstPage = listUserRuns(db, "a", { limit: 1 });
    const oldPage = listUserRuns(db, "a", { limit: 100 });
    const running = claimStep(db, 15_000)!;
    assert.equal(running.run_id, olderId);
    completeStep(db, running, { output: 1, nextStep: null, result: "done" });
    const updatedOlder = listUserRuns(db, "a", { limit: 100 }).runs.find(run => run.id === olderId)!;
    assert.equal(applyRunUpdate(firstPage, updatedOlder), firstPage); // not yet loaded
    assert.equal(mergeRunPages(firstPage, oldPage).runs.find(run => run.id === olderId)?.status, "queued");
    const merged = applyRunUpdate(mergeRunPages(firstPage, oldPage), updatedOlder);
    assert.equal(merged.runs.find(run => run.id === olderId)?.status, "completed");
  } finally { db.close(); }
});

test("history stream drains more than one bounded batch without losing updates", async () => {
  const db = openDatabase(":memory:");
  for (let i = 0; i < 220; i++) create(db);
  const all = listUserRuns(db, "a", { limit: 100 });
  const iterator = readSnapshots<RunHistoryEvent>(runChangeStream({ db, userId: "a", after: 0, request: new Request("http://localhost") }));
  await iterator.next();
  const seen = new Set<string>();
  for (let i = 0; i < 220; i++) {
    const update = (await iterator.next()).value!;
    assert.ok(update.type === "run.updated");
    seen.add(update.run.id);
  }
  assert.equal(seen.size, 220);
  assert.equal(all.changeCursor, "220");
  publishRunUpdate("b", "foreign");
  await iterator.return(undefined);
  for (const cursor of ["-1", "1.5", "bad", "9007199254740992"]) assert.throws(() => parseChangeCursor(cursor));
});
