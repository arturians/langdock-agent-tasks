import { CreateDocumentProcessor } from "./create-document.ts";
import { readPromptInput } from "../step-processor.ts";
import type { StepContext, StepProcessor, ProcessorResult } from "../step-processor.ts";

export class PrepareRecommendationProcessor implements StepProcessor {
  readonly title = "Prepare a recommendation";
  async execute({ input }: StepContext): Promise<ProcessorResult> {
    const data = readPromptInput(input);
    const output = { ...data, recommendation: `Simulated work product for: ${data.prompt}` };
    return { output, nextProcessor: CreateDocumentProcessor.name };
  }
}

// Keep the persisted class name stable across Next.js minification and the worker.
Object.defineProperty(PrepareRecommendationProcessor, "name", { value: "PrepareRecommendationProcessor" });
