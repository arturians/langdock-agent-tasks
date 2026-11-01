import type { RunPage } from "./types.ts";

/** Append older results without duplicating or overwriting fresher live rows. */
export function mergeRunPages(current: RunPage, older: RunPage): RunPage {
  const rows = new Map(current.runs.map(run => [run.id, run]));
  for (const run of older.runs) {
    const existing = rows.get(run.id);
    if (!existing || run.revision > existing.revision) rows.set(run.id, run);
  }
  return {
    runs: [...rows.values()].sort((a, b) => b.created_at - a.created_at || (a.id > b.id ? -1 : a.id < b.id ? 1 : 0)),
    endCursor: older.endCursor ?? current.endCursor,
    nextCursor: older.nextCursor,
    changeCursor: current.changeCursor,
  };
}

/** A delta updates one loaded row, or inserts a task above the loaded boundary. */
export function applyRunUpdate(page: RunPage, run: import("./types.ts").RunSummary): RunPage {
  const existing = page.runs.find(row => row.id === run.id);
  if (existing && existing.revision >= run.revision) return page;
  if (existing) return { ...page, runs: page.runs.map(row => row.id === run.id ? run : row) };
  const oldest = page.runs.at(-1);
  if (!existing && oldest && (run.created_at < oldest.created_at ||
    (run.created_at === oldest.created_at && run.id < oldest.id))) return page;
  return {
    ...page,
    runs: [...page.runs.filter(row => row.id !== run.id), run]
      .sort((a, b) => b.created_at - a.created_at || (a.id > b.id ? -1 : a.id < b.id ? 1 : 0)),
  };
}
