import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { UnderstandRequestProcessor } from "./agent/steps/understand-request.ts";
import { stepRegistry } from "./agent/processors.ts";
import type { StepRegistry } from "./agent/step-registry.ts";
import type { AgentEvent } from "./types.ts";
import { completeStep, failRun, nextIncompleteStep, startStep } from "./run-store.ts";
import type { StepDefinition } from "./run-store.ts";

type Emit = (event: AgentEvent) => void;

const stepDelay = Number(process.env.AGENT_STEP_DELAY_MS ?? 2_500);
const stepTransitionDelay = Number(process.env.AGENT_STEP_TRANSITION_DELAY_MS ?? 600);

export function firstStep(prompt: string): StepDefinition {
  return { type: UnderstandRequestProcessor.name, input: { prompt } };
}

export async function runAgent(input: {
  db: DatabaseSync;
  runId: string;
  prompt: string;
  signal: AbortSignal;
  emit: Emit;
  registry?: StepRegistry;
}): Promise<void> {
  const { db, runId, signal, emit } = input;
  const registry = input.registry ?? stepRegistry;
  emit({ type: "run.started", runId, prompt: input.prompt, occurredAt: new Date().toISOString() });

  try {
    while (true) {
      signal.throwIfAborted();
      const step = nextIncompleteStep(db, runId);
      if (!step) throw new Error("Unfinished run has no executable step.");
      startStep(db, step);
      const processor = registry.get(step.type);
      const title = processor.title;
      emit({ type: "step.started", runId, step: step.step_number, title, occurredAt: new Date().toISOString() });
      await delay(stepDelay, undefined, { signal });
      const outcome = await processor.execute({
        runId, stepId: step.id, input: JSON.parse(step.input_json), signal,
      });
      if (outcome.nextProcessor !== null) registry.get(outcome.nextProcessor);
      completeStep(db, step, outcome.nextProcessor === null
        ? { output: outcome.output, nextStep: null, result: outcome.result }
        : { output: outcome.output, nextStep: { type: outcome.nextProcessor, input: outcome.output } });
      emit({
        type: "step.completed", runId, step: step.step_number, title,
        detail: outcome.detail,
        occurredAt: new Date().toISOString(),
      });
      if (outcome.nextProcessor === null) {
        emit({ type: "run.completed", runId, result: outcome.result, occurredAt: new Date().toISOString() });
        return;
      }
      await delay(stepTransitionDelay, undefined, { signal });
    }
  } catch (error) {
    failRun(db, runId, error instanceof Error ? error.message : "Unknown agent error");
    throw error;
  }
}
