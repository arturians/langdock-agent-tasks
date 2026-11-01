import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { createRun, ensureUser, findUserRun } from "./run-store.ts";
import { parseUserId, requestUserId } from "./user-id.ts";

const userA = "1a72d293-a436-4cdd-a337-184a3a3693dc";
const userB = "2b72d293-a436-4cdd-a337-184a3a3693dc";

test("identity requires a valid UUID and normalizes manual input", () => {
  assert.equal(parseUserId(` ${userA.toUpperCase()} `), userA);
  for (const value of [null, "", "user-a", "../../../file", "1a72d293-a436-4cdd-0337-184a3a3693dc"]) {
    assert.equal(parseUserId(value), null);
  }
  assert.equal(requestUserId(new Request("http://localhost")), null);
  assert.equal(requestUserId(new Request("http://localhost", { headers: { "X-User-Id": userA } })), userA);
});

test("user registration is idempotent and tasks are visible only to their owner", () => {
  const db = openDatabase(":memory:");
  try {
    ensureUser(db, userA, 100);
    ensureUser(db, userA, 200);
    assert.equal(db.prepare("SELECT created_at FROM users WHERE id = ?").get(userA)?.created_at, 100);
    const runId = createRun(db, { userId: userA, prompt: "Test", firstStep: { type: "first", input: null } });
    assert.equal(findUserRun(db, userA, runId)?.id, runId);
    assert.equal(findUserRun(db, userB, runId), undefined);
    assert.equal(findUserRun(db, userA, "unknown"), undefined);
    ensureUser(db, userB);
    assert.equal(findUserRun(db, userA, runId)?.id, runId);
  } finally {
    db.close();
  }
});
