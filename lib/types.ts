export type AgentEvent =
  | {
      type: "run.started";
      runId: string;
      prompt: string;
      occurredAt: string;
    }
  | {
      type: "step.started";
      runId: string;
      step: number;
      title: string;
      occurredAt: string;
    }
  | {
      type: "step.completed";
      runId: string;
      step: number;
      title: string;
      detail?: string;
      occurredAt: string;
    }
  | {
      type: "run.completed";
      runId: string;
      result: string;
      occurredAt: string;
    }
  | {
      type: "run.failed";
      runId: string;
      error: string;
      occurredAt: string;
    };

export type ExternalAction = {
  id: string;
  runId: string;
  title: string;
  content: string;
  createdAt: string;
};
