export type StepNotification = { userId: string; runId: string; stepId: string };

type Listener = (runId: string, stepId?: string) => void;

// Route bundles and development reloads must share the same process-local hub.
const shared = globalThis as typeof globalThis & { agentRunListeners?: Map<string, Set<Listener>> };
const listeners = shared.agentRunListeners ??= new Map<string, Set<Listener>>();

export function subscribeToRuns(userId: string, listener: Listener): () => void {
  let entries = listeners.get(userId);
  if (!entries) listeners.set(userId, entries = new Set());
  entries.add(listener);
  return () => {
    entries.delete(listener);
    if (entries.size === 0) listeners.delete(userId);
  };
}

export function publishRunUpdate(userId: string, runId: string, stepId?: string): void {
  for (const listener of listeners.get(userId) ?? []) listener(runId, stepId);
}

/** Notifications are wake-ups, not the source of truth; failures must not fail work. */
export class WorkerNotifier {
  private readonly pending = new Set<Promise<void>>();

  notify(update: StepNotification): void {
    const base = process.env.AGENT_API_URL ?? "http://127.0.0.1:3000";
    const request = Promise.resolve().then(() => fetch(new URL("/api/internal/run-updates", base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update), signal: AbortSignal.timeout(1000),
    })).then(async response => {
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Notification rejected (${response.status})`);
    }).catch(() => {
      // API downtime is expected. SSE snapshots/reconciliation recover missed updates.
    }).finally(() => this.pending.delete(request));
    this.pending.add(request);
  }

  async flush(): Promise<void> { await Promise.all(this.pending); }
}
