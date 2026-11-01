import { ProduceResponseProcessor } from "./produce-response.ts";
import { createDocument } from "../../fake-external-service.ts";
import { readPromptInput } from "../step-processor.ts";
import type { StepContext, StepProcessor, ProcessorResult } from "../step-processor.ts";

export class CreateDocumentProcessor implements StepProcessor {
  readonly title = "Create a document in an external system";
  async execute({ runId, input, signal }: StepContext): Promise<ProcessorResult> {
    signal.throwIfAborted();
    const data = readPromptInput(input);
    if (typeof data.recommendation !== "string") throw new Error("Missing recommendation.");
    const document = await createDocument({
      runId,
      title: `Agent result: ${data.prompt.slice(0, 48)}`,
      content: data.recommendation,
    });
    const output = { ...data, documentId: document.id };
    return {
      output,
      nextProcessor: ProduceResponseProcessor.name,
      detail: `Created external document ${document.id}`,
    };
  }
}

// Keep the persisted class name stable across Next.js minification and the worker.
Object.defineProperty(CreateDocumentProcessor, "name", { value: "CreateDocumentProcessor" });
