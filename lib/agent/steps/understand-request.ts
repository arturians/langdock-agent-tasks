import { SearchInformationProcessor } from "./search-information.ts";
import { readPromptInput } from "../step-processor.ts";
import type { StepContext, StepProcessor, ProcessorResult } from "../step-processor.ts";

export class UnderstandRequestProcessor implements StepProcessor {
  readonly title = "Understand the request";
  async execute({ input }: StepContext): Promise<ProcessorResult> {
    const data = readPromptInput(input);
    const output = { ...data, understanding: `Simulated understanding of: ${data.prompt}` };
    return { output, nextProcessor: SearchInformationProcessor.name };
  }
}

// Keep the persisted class name stable across Next.js minification and the worker.
Object.defineProperty(UnderstandRequestProcessor, "name", { value: "UnderstandRequestProcessor" });
