"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { AgentEvent, ExternalAction } from "@/lib/types";
import { useRuns } from "./use-runs";
import { UserIdentity } from "./user-identity";

const defaultPrompt = "Research the most important considerations for adopting an enterprise AI assistant.";

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "run.started":
      return "Run accepted by the API";
    case "step.started":
      return event.title;
    case "step.completed":
      return event.detail ?? `${event.title} completed`;
    case "run.completed":
      return "Run completed";
    case "run.failed":
      return event.error;
  }
}

export default function Home() {
  const [userId, setUserId] = useState("");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [documents, setDocuments] = useState<ExternalAction[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [debugMessage, setDebugMessage] = useState<string | null>(null);
  const tasks = useRuns(userId);
  const events = tasks.progress?.events ?? [];
  const running = tasks.progress?.status === "running" || tasks.progress?.status === "queued";

  const changeUser = useCallback((id: string) => {
    setUserId(id);
    setDebugMessage(null);
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch("/api/fake-tools/documents", { cache: "no-store" });
      if (!response.ok) throw new Error("Cannot load external documents.");
      const body = (await response.json()) as { documents: ExternalAction[] };
      setDocuments(body.documents);
      setDocumentError(null);
    } catch {
      setDocumentError("External documents are unavailable.");
    }
  }, []);

  useEffect(() => {
    const refresh = async () => { await loadDocuments(); };
    void refresh();
  }, [loadDocuments, tasks.selectedId, tasks.progress?.status]);

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim()) await tasks.submit(prompt.trim());
  }

  async function resetDocuments() {
    await fetch("/api/fake-tools/documents", { method: "DELETE" });
    await loadDocuments();
  }

  async function terminateBackend() {
    setDebugMessage("API termination requested. The worker continues. Restart the API with pnpm dev.");
    try {
      await fetch("/api/debug/crash", { method: "POST" });
    } catch {
      // The request may fail because the endpoint intentionally terminates its own process.
    }
  }

  const runId = tasks.selectedId;
  const completed = events.find((event) => event.type === "run.completed");
  const statusLabel = tasks.progress?.status ?? (runId ? "Loading" : "Ready");

  return (
    <main className="app-shell">
      <UserIdentity disabled={tasks.submitting} onChange={changeUser} />
      <section className="hero">
        <div className="workspace-pill"><span className="brand-orb" aria-hidden="true" />Langdock Platform</div>
        <h1>What are we working on?</h1>
        <form className="composer" onSubmit={startRun}>
          <label className="sr-only" htmlFor="prompt">Agent task</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Give the agent a task…" rows={3} />
          <div className="composer-footer">
            <span>5 simulated steps · about 15 seconds</span>
            <button aria-label="Start agent run" disabled={tasks.submitting || !prompt.trim() || !userId} type="submit">
              {tasks.submitting ? <span className="spinner" /> : <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </form>
        <p className="connection-note">Tasks run in a separate worker. Closing this page does not stop execution.</p>
      </section>

      <div className="run-workspace">
        <section className="task-history" aria-label="Your tasks">
          <div className="section-heading"><span className="section-label">Your tasks</span></div>
          {tasks.loading && <p className="quiet-state">Loading task history…</p>}
          {!tasks.loading && tasks.runs.length === 0 && <p className="quiet-state">No tasks for this user ID.</p>}
          {tasks.historyError && <p className="error-message">{tasks.historyError}</p>}
          {tasks.submissionError && <p className="error-message">{tasks.submissionError}</p>}
          <div className="task-list">
            {tasks.runs.map((run) => (
              <button type="button" key={run.id} aria-pressed={run.id === runId} disabled={tasks.submitting} onClick={() => tasks.selectRun(run.id)}>
                <strong>{run.prompt}</strong>
                <span>{run.status} · {new Date(run.created_at).toLocaleString()}</span>
              </button>
            ))}
          </div>
          {tasks.hasMore && <button className="load-more" type="button" disabled={tasks.loadingMore} onClick={() => void tasks.loadMore()}>
            {tasks.loadingMore ? "Loading…" : "Load more tasks"}
          </button>}
        </section>

        <section className="activity" aria-live="polite">
          <div className="section-heading">
            <div><span className="section-label">Current run</span>{runId && <code>{runId}</code>}</div>
            <div className="run-controls">
              {process.env.NODE_ENV === "development" && running && (
                <button className="crash-button" onClick={terminateBackend} type="button">Simulate API crash</button>
              )}
              <span className={`status status-${statusLabel.toLowerCase()}`}><i aria-hidden="true" />{statusLabel}</span>
            </div>
          </div>
          {events.length === 0 ? <div className="quiet-state">Run activity will appear here.</div> : (
            <div className="timeline">
              {events.map((event, index) => (
                <div className="timeline-row" key={`${event.type}-${event.occurredAt}-${index}`}>
                  <span className={`timeline-dot ${event.type.endsWith("completed") ? "dot-complete" : ""}`} />
                  <strong>{eventLabel(event)}</strong>
                  <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
                </div>
              ))}
            </div>
          )}
          {tasks.progressError && <p className="error-message">{tasks.progressError}</p>}
          {debugMessage && <p className="error-message">{debugMessage}</p>}
          {completed?.type === "run.completed" && <div className="result">{completed.result}</div>}
        </section>

      </div>

      <section className="external-system">
        <div className="section-heading">
          <div><span className="section-label">Fake external system</span><p>Documents created by simulated tool calls appear here.</p></div>
          {documents.length > 0 && <button className="text-button" onClick={resetDocuments} type="button">Reset</button>}
        </div>
        {documentError && <p className="error-message">{documentError}</p>}
        {documents.length === 0 ? <div className="quiet-state">No documents created.</div> : (
          <div className="document-list">
            {documents.slice().reverse().map((document) => (
              <article key={document.id}>
                <span className="document-icon" aria-hidden="true">↗</span>
                <div><strong>{document.title}</strong><small>Run {document.runId.slice(0, 8)} · {new Date(document.createdAt).toLocaleString()}</small></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
