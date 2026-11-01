import { UnderstandRequestProcessor } from "./agent/steps/understand-request.ts";
import type { StepDefinition } from "./run-store.ts";

export function firstStep(prompt: string): StepDefinition {
  return { type: UnderstandRequestProcessor.name, input: { prompt } };
}
