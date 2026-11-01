import { readPromptInput } from "../step-processor.ts";
import type { StepContext, StepProcessor, ProcessorResult } from "../step-processor.ts";

export class ProduceResponseProcessor implements StepProcessor {
  readonly title = "Produce the final response";
  async execute({ input }: StepContext): Promise<ProcessorResult> {
    const data = readPromptInput(input);
    const result = `The agent completed the task “${data.prompt}” and created a document with its result.`;
    return { output: { ...data, result }, nextProcessor: null, result };
  }
}

// Keep the persisted class name stable across Next.js minification and the worker.
Object.defineProperty(ProduceResponseProcessor, "name", { value: "ProduceResponseProcessor" });
