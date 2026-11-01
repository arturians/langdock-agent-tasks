import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { createRun } from "./run-store.ts";
import { migrate } from "./migrations.ts";

test("migration preserves stored steps while converting legacy types to class names", () => {
  const db = openDatabase(":memory:");
  try {
    const runId = createRun(db, {
      userId: "a", prompt: "Test", firstStep: { type: "understand_request", input: { prompt: "Test" } },
    });
    db.exec("PRAGMA user_version = 1");
    migrate(db);
    const step = db.prepare("SELECT * FROM run_steps WHERE run_id = ?").get(runId)!;
    assert.equal(step.type, "UnderstandRequestProcessor");
    assert.equal(step.input_json, '{"prompt":"Test"}');
    assert.equal(step.status, "pending");
    migrate(db);
    assert.equal(db.prepare("SELECT count(*) AS n FROM run_steps").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("a run and only its first step survive reopening and migrations", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-db-"));
  const filename = path.join(directory, "agent.db");
  try {
    const db = openDatabase(filename);
    let runId: string;
    try {
      runId = createRun(db, {
        userId: "user-a", prompt: "Research a topic",
        firstStep: { type: "understand_request", input: { prompt: "Research a topic" } },
      });
    } finally {
      db.close();
    }
    const reopened = openDatabase(filename);
    try {
      const run = reopened.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, "user-a");
      assert.equal(run?.status, "queued");
      const steps = reopened.prepare("SELECT * FROM run_steps WHERE run_id = ?").all(runId);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].step_number, 1);
      assert.deepEqual(JSON.parse(steps[0].input_json as string), { prompt: "Research a topic" });
      assert.equal(reopened.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
      assert.equal(reopened.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
      assert.equal(reopened.prepare("PRAGMA synchronous").get()?.synchronous, 2);
      assert.throws(() => reopened.prepare("DELETE FROM users WHERE id = ?").run("user-a"));
      reopened.prepare("DELETE FROM runs WHERE id = ?").run(runId);
      assert.equal(reopened.prepare("SELECT count(*) AS n FROM run_steps").get()?.n, 0);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed first-step insertion rolls back the run and user", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec(`CREATE TRIGGER reject_step BEFORE INSERT ON run_steps
      BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);
    assert.throws(() => createRun(db, {
      userId: "user-a", prompt: "Test", firstStep: { type: "first", input: null },
    }), /injected write failure/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM runs").get()?.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get()?.n, 0);
  } finally {
    db.close();
  }
});
