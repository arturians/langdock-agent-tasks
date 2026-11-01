import { PrepareRecommendationProcessor } from "./prepare-recommendation.ts";
import { readPromptInput } from "../step-processor.ts";
import type { StepContext, StepProcessor, ProcessorResult } from "../step-processor.ts";

export class SearchInformationProcessor implements StepProcessor {
  readonly title = "Search available information";
  async execute({ input }: StepContext): Promise<ProcessorResult> {
    const data = readPromptInput(input);
    const output = { ...data, findings: `Simulated findings for: ${data.prompt}` };
    return { output, nextProcessor: PrepareRecommendationProcessor.name };
  }
}
