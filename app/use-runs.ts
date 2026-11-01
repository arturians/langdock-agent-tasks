"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunProgress } from "@/lib/run-progress";
import { mergeRunPages } from "@/lib/merge-run-pages";
import type { RunPage } from "@/lib/types";
import { restoredSelection, selectionKey } from "@/lib/run-selection";
import { readSnapshots } from "@/lib/read-sse";
import { USER_ID_HEADER } from "@/lib/user-id";

export function useRuns(userId: string) {
  const [history, setHistory] = useState<RunPage & { userId: string }>({ userId: "", runs: [], nextCursor: null, endCursor: null });
  const [selection, setSelection] = useState<{ userId: string; id: string | null }>({ userId: "", id: null });
  const [snapshot, setSnapshot] = useState<{ userId: string; id: string; progress: RunProgress } | null>(null);
  const [historyError, setHistoryError] = useState<{ userId: string; message: string } | null>(null);
  const [progressError, setProgressError] = useState<{ userId: string; id: string; message: string } | null>(null);
  const [submissionError, setSubmissionError] = useState<{ userId: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef<AbortController | null>(null);
  const pagination = useRef<AbortController | null>(null);
  const [boundary, setBoundary] = useState<{ userId: string; cursor: string | null }>({ userId: "", cursor: null });
  const [moreRequest, setMoreRequest] = useState<{ userId: string; controller: AbortController } | null>(null);
  const through = boundary.userId === userId ? boundary.cursor : null;
  const selectedId = selection.userId === userId ? selection.id : null;

  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    return () => {
      pagination.current?.abort();
      pagination.current = null;
    };
  }, [userId]);

  const selectRun = useCallback((id: string) => {
    setSelection({ userId, id });
    setSubmissionError(null);
  }, [userId]);

  useEffect(() => {
    if (!userId || !selectedId) return;
    try { localStorage.setItem(selectionKey(userId), selectedId); } catch { /* Selection still works in this tab. */ }
  }, [userId, selectedId]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let restorationAttempted = false;
    async function connect() {
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (through) params.set("through", through);
        const response = await fetch(`/api/runs/events?${params}`, { headers: { [USER_ID_HEADER]: userId }, cache: "no-store", signal: controller.signal });
        for await (const page of readSnapshots<RunPage>(response)) {
          const { runs } = page;
          if (controller.signal.aborted) return;
          setHistory({ userId, ...page });
          if (page.endCursor) setBoundary(current => current.userId === userId && current.cursor === page.endCursor
            ? current : { userId, cursor: page.endCursor });
          setHistoryError(null);
          let restored: string | null = runs[0]?.id ?? null;
          if (!restorationAttempted) {
            let saved: string | null = null;
            try { saved = localStorage.getItem(selectionKey(userId)); } catch { /* Use the latest task. */ }
            restored = restoredSelection(runs, saved);
            // A saved selection can be older than the first loaded page.
            if (saved && !runs.some(run => run.id === saved)) {
              const owned = await fetch(`/api/runs/${encodeURIComponent(saved)}`, {
                headers: { [USER_ID_HEADER]: userId }, cache: "no-store", signal: controller.signal,
              });
              if (owned.ok) restored = saved;
              else if (owned.status !== 404) throw new Error("Cannot restore the selected task. Reconnecting.");
            }
            restorationAttempted = true;
          }
          if (controller.signal.aborted) return;
          setSelection((current) => current.userId === userId && current.id !== null ? current : { userId, id: restored });
        }
        if (!controller.signal.aborted) setHistoryError({ userId, message: "History connection lost. Reconnecting." });
      } catch {
        if (!controller.signal.aborted) setHistoryError({ userId, message: "Cannot connect to task history. Reconnecting." });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(connect, 1000);
      }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [userId, through]);

  useEffect(() => {
    if (!userId || !selectedId) return;
    const id = selectedId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      let finished = false;
      try {
        const response = await fetch(`/api/runs/${id}/events`, { headers: { [USER_ID_HEADER]: userId }, cache: "no-store", signal: controller.signal });
        if (response.status === 404) {
          finished = true;
          throw new Error("This task is unavailable for the current user.");
        }
        for await (const progress of readSnapshots<RunProgress>(response)) {
          if (controller.signal.aborted) return;
          setSnapshot({ userId, id, progress });
          setProgressError(null);
          finished = progress.status === "completed" || progress.status === "failed";
          if (finished) break;
        }
        if (!finished && !controller.signal.aborted) throw new Error("Progress connection lost. Reconnecting; execution continues.");
      } catch (error) {
        if (!controller.signal.aborted) setProgressError({ userId, id, message: error instanceof Error ? error.message : "Connection lost. Reconnecting." });
      } finally {
        if (!controller.signal.aborted && !finished) timer = setTimeout(connect, 1000);
      }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [userId, selectedId]);

  async function loadMore() {
    if (pagination.current || history.userId !== userId || !history.nextCursor) return;
    const controller = new AbortController();
    pagination.current = controller;
    setMoreRequest({ userId, controller });
    try {
      const params = new URLSearchParams({ limit: "20", cursor: history.nextCursor });
      const response = await fetch(`/api/runs?${params}`, {
        headers: { [USER_ID_HEADER]: userId }, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Cannot load more tasks. Try again.");
      const page = await response.json() as RunPage;
      if (controller.signal.aborted) return;
      setHistory(current => current.userId === userId ? { userId, ...mergeRunPages(current, page) } : current);
      if (page.endCursor) setBoundary({ userId, cursor: page.endCursor });
      setHistoryError(null);
    } catch (error) {
      if (!controller.signal.aborted) setHistoryError({ userId, message: error instanceof Error ? error.message : "Cannot load more tasks." });
    } finally {
      if (pagination.current === controller) {
        pagination.current = null;
        setMoreRequest(current => current?.controller === controller ? null : current);
      }
    }
  }

  async function submit(prompt: string) {
    if (!userId || submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST", headers: { "Content-Type": "application/json", [USER_ID_HEADER]: userId },
        body: JSON.stringify({ prompt }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Task submission failed (${response.status}).`);
      const { runId } = await response.json() as { runId: string };
      if (controller.signal.aborted) return;
      selectRun(runId);
    } catch (error) {
      if (!controller.signal.aborted) setSubmissionError({ userId, message: error instanceof Error ? error.message : "Submission failed. Check history before retrying." });
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
      submission.current = null;
    }
  }

  return {
    runs: history.userId === userId ? history.runs : [],
    loading: Boolean(userId) && history.userId !== userId,
    selectedId,
    progress: snapshot?.userId === userId && snapshot.id === selectedId ? snapshot.progress : null,
    historyError: historyError?.userId === userId ? historyError.message : null,
    progressError: progressError?.userId === userId && progressError.id === selectedId ? progressError.message : null,
    submissionError: submissionError?.userId === userId ? submissionError.message : null,
    submitting, selectRun, submit, loadMore, loadingMore: moreRequest?.userId === userId && !moreRequest.controller.signal.aborted,
    hasMore: history.userId === userId && history.nextCursor !== null,
  };
}
