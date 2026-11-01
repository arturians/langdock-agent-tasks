import assert from "node:assert/strict";
import { test } from "node:test";
import { StepExecutionService } from "./agent/step-execution-service.ts";
import type { ProcessorResult, StepContext, StepProcessor } from "./agent/step-processor.ts";
import { StepRegistry } from "./agent/step-registry.ts";
import { openDatabase } from "./db.ts";
import { createRun } from "./run-store.ts";

test("service executes outside a transaction and commits before notifying the client", async () => {
  const db = openDatabase(":memory:");
  class FinalProcessor implements StepProcessor {
    readonly title = "Final";
    async execute({ input }: StepContext): Promise<ProcessorResult> {
      // BEGIN would fail if a persistence transaction were held during execution.
      db.exec("BEGIN IMMEDIATE");
      db.exec("ROLLBACK");
      return { output: input, nextProcessor: null, result: "Done" };
    }
  }
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: FinalProcessor.name, input: { value: 42 } } });
    const service = new StepExecutionService(db, new StepRegistry([FinalProcessor]));
    let completed = false;
    await service.executeNext(runId, new AbortController().signal, (event) => {
      if (event.type === "step.completed") {
        completed = true;
        assert.equal(db.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status, "completed");
        assert.equal(db.prepare("SELECT output_json FROM run_steps WHERE run_id = ?").get(runId)?.output_json, '{"value":42}');
      }
    });
    assert.ok(completed);
  } finally {
    db.close();
  }
});

test("service rejects an unregistered continuation before saving successful output", async () => {
  const db = openDatabase(":memory:");
  class BrokenProcessor implements StepProcessor {
    readonly title = "Broken continuation";
    async execute(): Promise<ProcessorResult> {
      return { output: "not committed", nextProcessor: "MissingProcessor" };
    }
  }
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: BrokenProcessor.name, input: null } });
    const service = new StepExecutionService(db, new StepRegistry([BrokenProcessor]));
    const events: string[] = [];
    await assert.rejects(
      () => service.executeNext(runId, new AbortController().signal, (event) => events.push(event.type)),
      /Unknown step type: MissingProcessor/,
    );
    service.recordFailure(runId, new Error("Unknown continuation"));
    const step = db.prepare("SELECT * FROM run_steps WHERE run_id = ?").get(runId)!;
    assert.equal(step.output_json, null);
    assert.equal(step.status, "failed");
    assert.equal(db.prepare("SELECT count(*) AS n FROM run_steps").get()?.n, 1);
    assert.deepEqual(events, ["step.started"]);
  } finally {
    db.close();
  }
});
