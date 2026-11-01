import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { FakeExternalService } from "./fake-external-service.ts";
import { openDatabase } from "./db.ts";
import { claimRun, createRun, nextIncompleteStep, startStep } from "./run-store.ts";

const input = { runId: "run", title: "Title", content: "Content", idempotencyKey: "stable-key" };
const moduleUrl = (file: string) => pathToFileURL(path.resolve(file)).href;

test("repeats survive reopening and reject changed payloads", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "external-repeat-"));
  try {
    const filename = path.join(directory, "external.db");
    const first = new FakeExternalService(filename);
    const document = first.createDocument(input);
    first.close();
    const second = new FakeExternalService(filename);
    try {
      assert.deepEqual(second.createDocument(input), document);
      assert.throws(() => second.createDocument({ ...input, content: "different" }), /different document input/);
      assert.equal(second.listDocuments().length, 1);
      second.createDocument({ ...input, idempotencyKey: "another-key" });
      assert.equal(second.listDocuments().length, 2);
    } finally { second.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("legacy documents import once and reset does not reimport them", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "external-import-"));
  try {
    const filename = path.join(directory, "external.db");
    const legacy = { id: "old", runId: "old-run", title: "Old", content: "Old content", createdAt: "2026-01-01T00:00:00.000Z" };
    writeFileSync(path.join(directory, "fake-external-actions.json"), JSON.stringify([legacy]));
    const service = new FakeExternalService(filename);
    try {
      assert.deepEqual(service.listDocuments(), [legacy]);
      service.resetDocuments();
    } finally { service.close(); }
    const reopened = new FakeExternalService(filename);
    try { assert.deepEqual(reopened.listDocuments(), []); } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("concurrent processes using the same key create one document", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "external-concurrent-"));
  try {
    const filename = path.join(directory, "external.db");
    const code = `import { FakeExternalService } from ${JSON.stringify(moduleUrl("lib/fake-external-service.ts"))};
      const service = new FakeExternalService(${JSON.stringify(filename)});
      try { console.log(JSON.stringify(service.createDocument(${JSON.stringify(input)}))); } finally { service.close(); }`;
    const documents = await Promise.all(Array.from({ length: 4 }, () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { errors += chunk; });
      child.on("error", reject);
      child.on("close", status => status === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    })));
    assert.equal(new Set(documents.map(document => JSON.parse(document).id)).size, 1);
    const service = new FakeExternalService(filename);
    try { assert.equal(service.listDocuments().length, 1); } finally { service.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("crash after external commit but before step commit reuses the document on recovery", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "external-recovery-"));
  const agentFilename = path.join(directory, "agent.db");
  const externalFilename = path.join(directory, "external.db");
  const db = openDatabase(agentFilename);
  try {
    const runId = createRun(db, {
      userId: "a", prompt: "Recovery",
      firstStep: { type: "CreateDocumentProcessor", input: { prompt: "Recovery", recommendation: "Saved recommendation" } },
    });
    const claimed = claimRun(db, 15_000)!;
    const step = nextIncompleteStep(db, runId)!;
    startStep(db, step, claimed.lease_token);
    const env = { ...process.env, FAKE_EXTERNAL_DB_PATH: externalFilename, AGENT_DB_PATH: agentFilename, AGENT_STEP_DELAY_MS: "1", AGENT_STEP_TRANSITION_DELAY_MS: "1" };
    const crash = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { CreateDocumentProcessor } from ${JSON.stringify(moduleUrl("lib/agent/steps/create-document.ts"))};
      await new CreateDocumentProcessor().execute({
        runId: ${JSON.stringify(runId)}, stepId: ${JSON.stringify(step.id)},
        idempotencyKey: ${JSON.stringify(step.idempotency_key)}, input: ${step.input_json},
        signal: new AbortController().signal
      });
      process.exit(77);
    `], { cwd: directory, env, encoding: "utf8", timeout: 10_000 });
    assert.equal(crash.status, 77, crash.stderr);
    const before = new FakeExternalService(externalFilename);
    let originalId: string;
    try { originalId = before.listDocuments()[0].id; } finally { before.close(); }
    assert.equal(db.prepare("SELECT output_json FROM run_steps WHERE id = ?").get(step.id)?.output_json, null);
    db.prepare("UPDATE runs SET lease_expires_at = 0 WHERE id = ?").run(runId);
    const recovery = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { openDatabase } from ${JSON.stringify(moduleUrl("lib/db.ts"))};
      import { workOnce } from ${JSON.stringify(moduleUrl("lib/worker.ts"))};
      const db = openDatabase();
      try { await workOnce(db, new AbortController().signal); } finally { db.close(); }
    `], { cwd: directory, env, encoding: "utf8", timeout: 10_000 });
    assert.equal(recovery.status, 0, recovery.stderr);
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status, "completed");
    const stored = db.prepare("SELECT output_json, attempts FROM run_steps WHERE id = ?").get(step.id)!;
    assert.equal(stored.attempts, 2);
    assert.equal(JSON.parse(stored.output_json as string).documentId, originalId);
    const after = new FakeExternalService(externalFilename);
    try { assert.equal(after.listDocuments().length, 1); } finally { after.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
