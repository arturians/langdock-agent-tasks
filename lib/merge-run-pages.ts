import type { RunPage } from "./types.ts";

/** Append older results without duplicating or overwriting fresher live rows. */
export function mergeRunPages(current: RunPage, older: RunPage): RunPage {
  const rows = new Map(current.runs.map(run => [run.id, run]));
  for (const run of older.runs) {
    const existing = rows.get(run.id);
    if (!existing || run.updated_at > existing.updated_at) rows.set(run.id, run);
  }
  return {
    runs: [...rows.values()].sort((a, b) => b.created_at - a.created_at || (a.id > b.id ? -1 : a.id < b.id ? 1 : 0)),
    endCursor: older.endCursor ?? current.endCursor,
    nextCursor: older.nextCursor,
  };
}
