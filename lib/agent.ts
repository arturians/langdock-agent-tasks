import { createDocument } from "@/lib/fake-external-service";
import type { AgentEvent } from "@/lib/types";

type Emit = (event: AgentEvent) => void;

const stepDelay = Number(process.env.AGENT_STEP_DELAY_MS ?? 2_500);
const stepTransitionDelay = Number(process.env.AGENT_STEP_TRANSITION_DELAY_MS ?? 600);

function occurredAt(): string {
  return new Date().toISOString();
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("The run was aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("The run was aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function executeStep(input: {
  runId: string;
  number: number;
  title: string;
  signal: AbortSignal;
  emit: Emit;
  operation?: () => Promise<string | undefined>;
}): Promise<void> {
  input.emit({
    type: "step.started",
    runId: input.runId,
    step: input.number,
    title: input.title,
    occurredAt: occurredAt(),
  });

  await delay(stepDelay, input.signal);
  const detail = await input.operation?.();

  input.emit({
    type: "step.completed",
    runId: input.runId,
    step: input.number,
    title: input.title,
    detail,
    occurredAt: occurredAt(),
  });
}

export async function runAgent(input: {
  runId: string;
  prompt: string;
  signal: AbortSignal;
  emit: Emit;
}): Promise<void> {
  input.emit({
    type: "run.started",
    runId: input.runId,
    prompt: input.prompt,
    occurredAt: occurredAt(),
  });

  await executeStep({
    runId: input.runId,
    number: 1,
    title: "Understand the request",
    signal: input.signal,
    emit: input.emit,
  });
  await delay(stepTransitionDelay, input.signal);

  await executeStep({
    runId: input.runId,
    number: 2,
    title: "Search available information",
    signal: input.signal,
    emit: input.emit,
  });
  await delay(stepTransitionDelay, input.signal);

  await executeStep({
    runId: input.runId,
    number: 3,
    title: "Prepare a recommendation",
    signal: input.signal,
    emit: input.emit,
  });
  await delay(stepTransitionDelay, input.signal);

  await executeStep({
    runId: input.runId,
    number: 4,
    title: "Create a document in an external system",
    signal: input.signal,
    emit: input.emit,
    operation: async () => {
      const document = await createDocument({
        runId: input.runId,
        title: `Agent result: ${input.prompt.slice(0, 48)}`,
        content: `Simulated work product for: ${input.prompt}`,
      });
      return `Created external document ${document.id}`;
    },
  });
  await delay(stepTransitionDelay, input.signal);

  await executeStep({
    runId: input.runId,
    number: 5,
    title: "Produce the final response",
    signal: input.signal,
    emit: input.emit,
  });

  input.emit({
    type: "run.completed",
    runId: input.runId,
    result: `The agent completed the task “${input.prompt}” and created a document with its result.`,
    occurredAt: occurredAt(),
  });
}
