import assert from "node:assert/strict";
import { test } from "node:test";
import { StepRegistry } from "./agent/step-registry.ts";
import type { StepProcessor } from "./agent/step-processor.ts";
import { stepRegistry } from "./agent/processors.ts";
import { StepExecutionService } from "./agent/step-execution-service.ts";
import { openDatabase } from "./db.ts";
import { claimStep, createRun } from "./run-store.ts";

class CustomProcessor implements StepProcessor {
  readonly title = "Custom action";
  async execute({ input }: import("./agent/step-processor.ts").StepContext): Promise<import("./agent/step-processor.ts").ProcessorResult> {
    return { output: input, nextProcessor: null, result: "Custom result", detail: "Custom detail" };
  }
}

test("registry selects processors by type and rejects duplicates and unknown types", () => {
  const registry = new StepRegistry([CustomProcessor]);
  assert.equal(registry.get(CustomProcessor.name).constructor, CustomProcessor);
  assert.throws(() => registry.get("missing"), /Unknown step type: missing/);
  assert.throws(() => new StepRegistry([CustomProcessor, CustomProcessor]), /Duplicate step processor: CustomProcessor/);
});

test("registered processors pass their output to the next action", async () => {
  let type = "UnderstandRequestProcessor";
  let input = { prompt: "Test" };
  for (const expectedNext of ["SearchInformationProcessor", "PrepareRecommendationProcessor", "CreateDocumentProcessor"]) {
    const outcome = await stepRegistry.get(type).execute({
      runId: "run", stepId: "step", idempotencyKey: "step", input, signal: new AbortController().signal,
    });
    assert.equal(outcome.nextProcessor, expectedNext);
    input = outcome.output as { prompt: string };
    type = expectedNext;
  }
  assert.ok("recommendation" in input);
  await assert.rejects(() => stepRegistry.get("UnderstandRequestProcessor").execute({
    runId: "run", stepId: "step", idempotencyKey: "step", input: null, signal: new AbortController().signal,
  }), /must contain a prompt/);
});

test("executor runs an injected processor without knowing its type or input shape", async () => {
  const db = openDatabase(":memory:");
  try {
    const runId = createRun(db, { userId: "a", prompt: "Test", firstStep: { type: CustomProcessor.name, input: [42] } });
    const events: import("./types.ts").AgentEvent[] = [];
    await new StepExecutionService(db, new StepRegistry([CustomProcessor])).execute(
      claimStep(db, 15_000)!, new AbortController().signal, (event) => events.push(event),
    );
    assert.equal(db.prepare("SELECT result FROM runs WHERE id = ?").get(runId)?.result, "Custom result");
    assert.equal(db.prepare("SELECT output_json FROM run_steps WHERE run_id = ?").get(runId)?.output_json, "[42]");
    assert.ok(events.some((event) => event.type === "step.completed" && event.detail === "Custom detail"));
  } finally {
    db.close();
  }
});
