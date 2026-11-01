import type { StepProcessor, StepProcessorClass } from "./step-processor.ts";

export class StepRegistry {
  private readonly processors = new Map<string, StepProcessor>();

  constructor(processors: readonly StepProcessorClass[]) {
    for (const Processor of processors) {
      if (this.processors.has(Processor.name)) {
        throw new Error(`Duplicate step processor: ${Processor.name}`);
      }
      this.processors.set(Processor.name, new Processor());
    }
  }

  get(type: string): StepProcessor {
    const processor = this.processors.get(type);
    if (!processor) throw new Error(`Unknown step type: ${type}`);
    return processor;
  }
}
