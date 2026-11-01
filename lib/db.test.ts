import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { createRun } from "./run-store.ts";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.ts";

test("migration preserves stored steps while converting legacy types to class names", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db, 1);
    const runId = "run";
    db.exec(`INSERT INTO users VALUES ('a', 1);
      INSERT INTO runs (id, user_id, prompt, created_at, updated_at) VALUES ('run', 'a', 'Test', 1, 1);
      INSERT INTO run_steps (id, run_id, step_number, type, input_json, idempotency_key, created_at)
        VALUES ('step', 'run', 1, 'understand_request', '{"prompt":"Test"}', 'key', 1);`);
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

test("migration moves an active lease and preserves ownership, output, and operation keys", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db, 2);
    db.exec(`INSERT INTO users VALUES ('owner', 1);
      INSERT INTO runs (id, user_id, prompt, status, created_at, updated_at, lease_token, lease_expires_at)
        VALUES ('run', 'owner', 'Test', 'running', 1, 2, 'old-token', 12345);
      INSERT INTO run_steps (id, run_id, step_number, type, input_json, output_json, status, attempts, idempotency_key, created_at)
        VALUES ('done', 'run', 1, 'UnderstandRequestProcessor', '{}', '{"saved":true}', 'completed', 1, 'key-1', 1),
               ('active', 'run', 2, 'SearchInformationProcessor', '{"saved":true}', NULL, 'running', 2, 'key-2', 2);`);
    migrate(db);
    assert.equal(db.prepare("SELECT user_id FROM run_steps WHERE id = 'done'").get()?.user_id, "owner");
    const active = db.prepare("SELECT * FROM run_steps WHERE id = 'active'").get()!;
    assert.equal(active.lease_token, "old-token");
    assert.equal(active.lease_expires_at, 12345);
    assert.equal(active.attempts, 2);
    assert.equal(active.idempotency_key, "key-2");
    assert.equal(db.prepare("SELECT output_json FROM run_steps WHERE id = 'done'").get()?.output_json, '{"saved":true}');
    assert.equal(db.prepare("PRAGMA table_info(runs)").all().some(column => column.name === "lease_token"), false);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("INSERT INTO users VALUES ('other', 3)");
    assert.throws(() => db.exec("UPDATE run_steps SET user_id = 'other' WHERE id = 'active'"), /FOREIGN KEY/);
  } finally { db.close(); }
});
