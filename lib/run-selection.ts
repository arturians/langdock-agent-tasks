import type { RunSummary } from "./types.ts";

export function selectionKey(userId: string): string {
  return `agent-selected-run:${userId}`;
}

export function restoredSelection(runs: RunSummary[], savedId: string | null): string | null {
  return runs.find((run) => run.id === savedId)?.id ?? runs[0]?.id ?? null;
}
