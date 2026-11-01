import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { UnderstandRequestProcessor } from "./agent/steps/understand-request.ts";
import { stepRegistry } from "./agent/processors.ts";
import type { StepRegistry } from "./agent/step-registry.ts";
import { StepExecutionService } from "./agent/step-execution-service.ts";
import type { Emit } from "./agent/step-execution-service.ts";
import type { StepDefinition } from "./run-store.ts";

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
  const execution = new StepExecutionService(db, input.registry ?? stepRegistry, stepDelay);
  emit({ type: "run.started", runId, prompt: input.prompt, occurredAt: new Date().toISOString() });

  try {
    while (true) {
      const outcome = await execution.executeNext(runId, signal, emit);
      if (outcome.nextProcessor === null) {
        emit({ type: "run.completed", runId, result: outcome.result, occurredAt: new Date().toISOString() });
        return;
      }
      await delay(stepTransitionDelay, undefined, { signal });
    }
  } catch (error) {
    execution.recordFailure(runId, error);
    throw error;
  }
}
