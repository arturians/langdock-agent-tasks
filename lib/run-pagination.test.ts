import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { createRun, listUserRuns } from "./run-store.ts";
import { decodeRunCursor, encodeRunCursor, parseRunPagination } from "./run-pagination.ts";
import { mergeRunPages } from "./merge-run-pages.ts";

test("keyset pages have no gaps or duplicates with tied timestamps and new insertions", () => {
  const db = openDatabase(":memory:");
  try {
    for (let i = 0; i < 45; i++) createRun(db, { userId: "a", prompt: `Task ${i}`, firstStep: { type: "first", input: null } });
    createRun(db, { userId: "other", prompt: "Other", firstStep: { type: "first", input: null } });
    db.exec("UPDATE runs SET created_at = 1000");
    const expected = db.prepare("SELECT id FROM runs WHERE user_id = 'a' ORDER BY created_at DESC, id DESC").all().map(run => run.id);
    let page = listUserRuns(db, "a", { limit: 7 });
    const seen = page.runs.map(run => run.id);
    const newest = createRun(db, { userId: "a", prompt: "Inserted later", firstStep: { type: "first", input: null } });
    while (page.nextCursor) {
      page = listUserRuns(db, "a", { limit: 7, cursor: decodeRunCursor(page.nextCursor) });
      seen.push(...page.runs.map(run => run.id));
    }
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, 45);
    assert.equal(seen.includes(newest), false);
    assert.equal(listUserRuns(db, "a").runs[0].id, newest);
    assert.equal(listUserRuns(db, "other").runs.length, 1);
    assert.deepEqual(listUserRuns(db, "missing"), { runs: [], nextCursor: null, endCursor: null, changeCursor: "0" });
    assert.deepEqual(db.prepare("PRAGMA index_info(runs_user_created)").all().map(column => column.name), ["user_id", "created_at", "id"]);
  } finally { db.close(); }
});

test("pagination validates limits and malformed cursors", () => {
  const valid = { createdAt: 1000, id: "550e8400-e29b-41d4-a716-446655440000" };
  assert.deepEqual(decodeRunCursor(encodeRunCursor(valid)), valid);
  assert.equal(parseRunPagination(new URLSearchParams()).limit, 20);
  for (const query of ["limit=0", "limit=101", "limit=-1", "limit=1.5", "cursor=", "cursor=bad", "cursor=%21"]) {
    assert.throws(() => parseRunPagination(new URLSearchParams(query)));
  }
  assert.throws(() => decodeRunCursor(encodeRunCursor({ createdAt: -1, id: valid.id })));
  assert.throws(() => decodeRunCursor(encodeRunCursor({ createdAt: 1, id: "invalid" })));
});

test("appending pages deduplicates rows and preserves fresher SSE state", () => {
  const run = { id: "a", prompt: "A", status: "running" as const, created_at: 100, updated_at: 20, revision: 20 };
  const current = { runs: [run], nextCursor: "first", endCursor: "first", changeCursor: "20" };
  const older = { runs: [{ ...run, status: "queued" as const, updated_at: 1, revision: 1 }, { ...run, id: "b", created_at: 50 }], nextCursor: null, endCursor: "last", changeCursor: "30" };
  const merged = mergeRunPages(current, older);
  assert.equal(merged.runs.length, 2);
  assert.equal(merged.runs[0].status, "running");
  assert.equal(merged.nextCursor, null);
  assert.equal(merged.endCursor, "last");
});
