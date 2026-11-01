import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import type { AgentEvent } from "../types.ts";
import { completeStep, failRun, nextIncompleteStep, startStep } from "../run-store.ts";
import type { StepRegistry } from "./step-registry.ts";
import type { ProcessorResult } from "./step-processor.ts";

export type Emit = (event: AgentEvent) => void;

/** Coordinates processor execution and persistence; processors do not access the DB. */
export class StepExecutionService {
  private readonly db: DatabaseSync;
  private readonly registry: StepRegistry;
  private readonly stepDelay: number;

  constructor(db: DatabaseSync, registry: StepRegistry, stepDelay = 0) {
    this.db = db;
    this.registry = registry;
    this.stepDelay = stepDelay;
  }

  async executeNext(runId: string, signal: AbortSignal, emit: Emit): Promise<ProcessorResult> {
    signal.throwIfAborted();
    const step = nextIncompleteStep(this.db, runId);
    if (!step) throw new Error("Unfinished run has no executable step.");
    startStep(this.db, step);
    const processor = this.registry.get(step.type);
    const title = processor.title;
    emit({ type: "step.started", runId, step: step.step_number, title, occurredAt: new Date().toISOString() });
    await delay(this.stepDelay, undefined, { signal });
    const outcome = await processor.execute({
      runId, stepId: step.id, input: JSON.parse(step.input_json), signal,
    });
    if (outcome.nextProcessor !== null) this.registry.get(outcome.nextProcessor);
    completeStep(this.db, step, outcome.nextProcessor === null
      ? { output: outcome.output, nextStep: null, result: outcome.result }
      : { output: outcome.output, nextStep: { type: outcome.nextProcessor, input: outcome.output } });
    emit({
      type: "step.completed", runId, step: step.step_number, title,
      detail: outcome.detail,
      occurredAt: new Date().toISOString(),
    });
    return outcome;
  }

  recordFailure(runId: string, error: unknown): void {
    failRun(this.db, runId, error instanceof Error ? error.message : "Unknown agent error");
  }
}
