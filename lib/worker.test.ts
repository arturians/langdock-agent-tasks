import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { claimRun, completeStep, createRun, failRun, LostLeaseError, nextIncompleteStep, renewLease, startStep } from "./run-store.ts";
import { readUserProgress } from "./run-progress.ts";
import { workOnce } from "./worker.ts";

test("heartbeat keeps an active task claimed and shutdown releases it for recovery", async () => {
  const db = openDatabase(":memory:");
  const controller = new AbortController();
  try {
    const id = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: "UnderstandRequestProcessor", input: { prompt: "Test" } } });
    const work = workOnce(db, controller.signal, 300);
    // Install the rejection handler immediately, before aborting the worker.
    const stopped = assert.rejects(work, /abort/i);
    await delay(450);
    assert.equal(claimRun(db, 15_000), undefined);
    controller.abort();
    await stopped;
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(id)?.status, "running");
    assert.equal(db.prepare("SELECT lease_token FROM runs WHERE id = ?").get(id)?.lease_token, null);
    assert.equal(claimRun(db, 15_000)?.id, id);
  } finally { controller.abort(); db.close(); }
});

test("exclusive claims and expired leases fence every stale write", () => {
  const db = openDatabase(":memory:");
  try {
    const id = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: "first", input: null } });
    const first = claimRun(db, 15_000)!;
    assert.equal(first.id, id);
    assert.equal(claimRun(db, 15_000), undefined);
    const step = nextIncompleteStep(db, id)!;
    startStep(db, step, first.lease_token);
    renewLease(db, id, first.lease_token, 30_000);
    db.prepare("UPDATE runs SET lease_expires_at = 0 WHERE id = ?").run(id);
    assert.throws(() => renewLease(db, id, first.lease_token, 30_000), LostLeaseError);
    const second = claimRun(db, 15_000)!;
    assert.notEqual(first.lease_token, second.lease_token);
    assert.throws(() => startStep(db, step, first.lease_token), LostLeaseError);
    assert.throws(() => completeStep(db, step, { output: null, nextStep: null, result: "stale" }, first.lease_token), LostLeaseError);
    assert.throws(() => failRun(db, id, "stale failure", first.lease_token), LostLeaseError);
    startStep(db, step, second.lease_token);
    completeStep(db, step, { output: 42, nextStep: null, result: "done" }, second.lease_token);
    assert.equal(db.prepare("SELECT lease_token FROM runs WHERE id = ?").get(id)?.lease_token, null);
    assert.equal(claimRun(db, 15_000), undefined);
  } finally { db.close(); }
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Worker condition timed out");
    await delay(20);
  }
}

test("a new worker resumes after SIGKILL, keeping committed steps and task ownership", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-worker-"));
  const filename = path.join(directory, "agent.db");
  const db = openDatabase(filename);
  const script = path.resolve("scripts/worker.ts");
  const launch = () => spawn(process.execPath, [script], {
    cwd: directory, stdio: "ignore",
    env: { ...process.env, AGENT_DB_PATH: filename, AGENT_STEP_DELAY_MS: "150", AGENT_STEP_TRANSITION_DELAY_MS: "1" },
  });
  let worker: ReturnType<typeof launch> | undefined;
  try {
    const id = createRun(db, { userId: "a", prompt: "Recovery check", firstStep: { type: "UnderstandRequestProcessor", input: { prompt: "Recovery check" } } });
    worker = launch();
    await waitFor(() => db.prepare("SELECT status FROM run_steps WHERE run_id = ? AND step_number = 2").get(id)?.status === "running");
    const exited = once(worker, "exit");
    worker.kill("SIGKILL");
    await exited;
    db.prepare("UPDATE runs SET lease_expires_at = 0 WHERE id = ?").run(id);
    worker = launch();
    await waitFor(() => db.prepare("SELECT status FROM runs WHERE id = ?").get(id)?.status === "completed");
    const steps = db.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_number").all(id);
    assert.equal(steps.length, 5);
    assert.equal(steps[0].attempts, 1);
    assert.equal(steps[1].attempts, 2);
    assert.ok(steps.every(step => step.status === "completed"));
    assert.equal(readUserProgress(db, "other", id), null);
    assert.equal(readUserProgress(db, "a", id)?.events.at(-1)?.type, "run.completed");
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, "exit");
      worker.kill("SIGTERM");
      await exited;
    }
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
