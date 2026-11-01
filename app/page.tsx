"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, ExternalAction } from "@/lib/types";

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
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [documents, setDocuments] = useState<ExternalAction[]>([]);
  const [running, setRunning] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/fake-tools/documents", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { documents: ExternalAction[] };
      setDocuments(body.documents);
    }
  }, []);

  useEffect(() => {
    const loadInitialDocuments = async () => {
      await loadDocuments();
    };

    void loadInitialDocuments();
    return () => abortController.current?.abort();
  }, [loadDocuments]);

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || running) return;

    const controller = new AbortController();
    abortController.current = controller;
    setEvents([]);
    setRequestError(null);
    setRunning(true);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`The run request failed with status ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          const data = message
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (data) {
            setEvents((current) => [...current, JSON.parse(data) as AgentEvent]);
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRequestError(error instanceof Error ? error.message : "The run was interrupted.");
      }
    } finally {
      setRunning(false);
      abortController.current = null;
      void loadDocuments();
    }
  }

  async function resetDocuments() {
    await fetch("/api/fake-tools/documents", { method: "DELETE" });
    await loadDocuments();
  }

  async function terminateBackend() {
    setRequestError("Backend termination requested. Restart it with pnpm dev to continue testing.");
    try {
      await fetch("/api/debug/crash", { method: "POST" });
    } catch {
      // The request may fail because the endpoint intentionally terminates its own process.
    }
  }

  const runId = events[0]?.runId;
  const completed = events.find((event) => event.type === "run.completed");
  const failed = events.find((event) => event.type === "run.failed");
  const statusLabel = running ? "Running" : completed ? "Completed" : failed ? "Failed" : "Ready";

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="workspace-pill"><span className="brand-orb" aria-hidden="true" />Langdock Platform</div>
        <h1>What are we working on?</h1>
        <form className="composer" onSubmit={startRun}>
          <label className="sr-only" htmlFor="prompt">Agent task</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Give the agent a task…" rows={3} />
          <div className="composer-footer">
            <span>5 simulated steps · about 15 seconds</span>
            <button aria-label="Start agent run" disabled={running || !prompt.trim()} type="submit">
              {running ? <span className="spinner" /> : <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </form>
        <p className="connection-note">This starter keeps the run inside one HTTP request. Refreshing the page loses its progress.</p>
      </section>

      <section className="activity" aria-live="polite">
        <div className="section-heading">
          <div><span className="section-label">Current run</span>{runId && <code>{runId}</code>}</div>
          <div className="run-controls">
            {process.env.NODE_ENV === "development" && running && (
              <button className="crash-button" onClick={terminateBackend} type="button">Simulate process crash</button>
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
        {requestError && <p className="error-message">{requestError}</p>}
        {completed?.type === "run.completed" && <div className="result">{completed.result}</div>}
      </section>

      <section className="external-system">
        <div className="section-heading">
          <div><span className="section-label">Fake external system</span><p>Documents created by simulated tool calls appear here.</p></div>
          {documents.length > 0 && <button className="text-button" onClick={resetDocuments} type="button">Reset</button>}
        </div>
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
