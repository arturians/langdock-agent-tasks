export type RunStatus = "queued" | "running" | "completed" | "failed";

export type RunSummary = {
  id: string;
  prompt: string;
  status: RunStatus;
  created_at: number;
  updated_at: number;
  revision: number;
};

export type RunPage = {
  runs: RunSummary[];
  nextCursor: string | null;
  endCursor: string | null;
  changeCursor: string;
};

export type RunHistoryEvent =
  | { type: "ready"; cursor: string }
  | { type: "run.updated"; cursor: string; run: RunSummary };

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
