import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { openDatabase } from "../lib/db.ts";
import { readSnapshots } from "../lib/read-sse.ts";
import type { RunProgress } from "../lib/run-progress.ts";
import type { RunSummary } from "../lib/types.ts";
import { createRun } from "../lib/run-store.ts";

test("accepted work survives API restart and remains scoped to its user", { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-http-"));
  const db = openDatabase(path.join(directory, "agent.db"));
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", AGENT_DB_PATH: path.join(directory, "agent.db"),
    FAKE_EXTERNAL_DB_PATH: path.join(directory, "external.db"),
    AGENT_STEP_DELAY_MS: "200", AGENT_STEP_TRANSITION_DELAY_MS: "1",
  };
  const owner = "1a72d293-a436-4cdd-a337-184a3a3693dc";
  const other = "2b72d293-a436-4cdd-a337-184a3a3693dc";
  const headers = { "X-User-Id": owner, "Content-Type": "application/json" };
  type Child = ReturnType<typeof spawn>;
  let api: Child | undefined;
  let worker: Child | undefined;
  let logs = "";
  const streams = new AbortController();
  const start = (args: string[]) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", chunk => { logs += chunk; });
    child.stderr!.on("data", chunk => { logs += chunk; });
    return child;
  };
  async function stop(child?: Child) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  async function waitFor(check: () => Promise<boolean> | boolean) {
    const deadline = Date.now() + 10_000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`Timed out. Process logs: ${logs}`);
      await delay(30);
    }
  }
  try {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    const base = `http://127.0.0.1:${port}`;
    env.AGENT_API_URL = base;
    const launchApi = async () => {
      api = start(["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)]);
      await waitFor(async () => {
        try { return (await fetch(`${base}/api/runs`, { headers })).ok; } catch { return false; }
      });
    };
    await launchApi();
    assert.equal((await fetch(`${base}/api/runs`)).status, 400);
    const historyStream = readSnapshots<{ runs: RunSummary[] }>(await fetch(`${base}/api/runs/events`, {
      headers, signal: AbortSignal.any([streams.signal, AbortSignal.timeout(5000)]),
    }));
    assert.deepEqual((await historyStream.next()).value?.runs, []);
    const submitted = await fetch(`${base}/api/runs`, { method: "POST", headers, body: JSON.stringify({ prompt: "Survive API restart" }) });
    assert.equal(submitted.status, 202);
    const { runId } = await submitted.json();
    const firstStepId = db.prepare("SELECT id FROM run_steps WHERE run_id = ?").get(runId)!.id as string;
    assert.equal((await historyStream.next()).value?.runs[0].id, runId);
    assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status, "queued");
    const progressStream = readSnapshots<RunProgress>(await fetch(`${base}/api/runs/${runId}/events`, {
      headers, signal: AbortSignal.any([streams.signal, AbortSignal.timeout(5000)]),
    }));
    assert.equal((await progressStream.next()).value?.status, "queued");
    assert.equal((await fetch(`${base}/api/internal/run-updates`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: other, runId, stepId: firstStepId }),
    })).status, 404);
    assert.equal((await fetch(`${base}/api/internal/run-updates`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    })).status, 400);
    worker = start(["scripts/worker.ts"]);
    // This must arrive before the 15-second reconciliation timer: real worker push.
    const pushed = (await progressStream.next()).value!;
    assert.equal(pushed.status, "running");
    assert.deepEqual(pushed.notification, { userId: owner, runId, stepId: firstStepId });
    await progressStream.return(undefined);
    await historyStream.return(undefined);
    await waitFor(() => db.prepare("SELECT status FROM run_steps WHERE run_id = ? AND step_number = 1").get(runId)?.status === "running");
    await stop(api);
    await waitFor(() => db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status === "completed");
    await launchApi();
    const history = await (await fetch(`${base}/api/runs`, { headers })).json();
    assert.equal(history.runs[0].id, runId);
    assert.equal(history.runs[0].status, "completed");
    const progress = await (await fetch(`${base}/api/runs/${runId}`, { headers })).json();
    assert.equal(progress.events.at(-1).type, "run.completed");
    const reconnected = readSnapshots<RunProgress>(await fetch(`${base}/api/runs/${runId}/events`, { headers }));
    assert.equal((await reconnected.next()).value?.status, "completed");
    assert.equal((await reconnected.next()).done, true);
    const foreignHeaders = { "X-User-Id": other };
    assert.deepEqual((await (await fetch(`${base}/api/runs`, { headers: foreignHeaders })).json()).runs, []);
    assert.equal((await fetch(`${base}/api/runs/${runId}`, { headers: foreignHeaders })).status, 404);
    assert.equal((await fetch(`${base}/api/runs/${runId}/events`, { headers: foreignHeaders })).status, 404);
    const documents = await (await fetch(`${base}/api/fake-tools/documents`)).json();
    assert.equal(documents.documents.length, 1);
    const failedId = createRun(db, {
      userId: owner, prompt: "Invalid step input",
      firstStep: { type: "CreateDocumentProcessor", input: { prompt: "Missing recommendation" } },
    });
    let failure: RunProgress | undefined;
    for await (const snapshot of readSnapshots<RunProgress>(await fetch(`${base}/api/runs/${failedId}/events`, {
      headers, signal: AbortSignal.timeout(5000),
    }))) failure = snapshot;
    assert.equal(failure?.status, "failed");
    const lastEvent = failure?.events.at(-1);
    assert.ok(lastEvent?.type === "run.failed");
    assert.equal(lastEvent.error, "Missing recommendation.");
  } finally {
    streams.abort();
    await stop(api);
    await stop(worker);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
