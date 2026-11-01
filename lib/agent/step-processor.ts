import type { JsonValue } from "../run-store.ts";

export type StepContext = {
  runId: string;
  stepId: string;
  idempotencyKey: string;
  input: JsonValue;
  signal: AbortSignal;
};

export interface ProcessorOutput {
  output: JsonValue;
  detail?: string;
}

/** Output becomes the next processor's input; null ends the run. */
export type ProcessorResult = ProcessorOutput & (
  | { nextProcessor: string; result?: never }
  | { nextProcessor: null; result: string }
);

export interface StepProcessorClass {
  new (): StepProcessor;
  readonly name: string;
}

export interface StepProcessor {
  readonly title: string;
  execute(context: StepContext): Promise<ProcessorResult>;
}

/** Shared input shape for this simulated scenario, not an executor requirement. */
export function readPromptInput(input: JsonValue): { prompt: string; [key: string]: JsonValue } {
  if (!input || Array.isArray(input) || typeof input !== "object" || typeof input.prompt !== "string") {
    throw new Error("Step input must contain a prompt.");
  }
  return input as { prompt: string; [key: string]: JsonValue };
}
