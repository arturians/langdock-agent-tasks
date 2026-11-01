import { parseUserId } from "./user-id.ts";

export type RunCursor = { createdAt: number; id: string };
export class InvalidPaginationError extends Error {}

export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeRunCursor(value: string): RunCursor {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0 ||
      typeof cursor.id !== "string" || parseUserId(cursor.id) !== cursor.id) throw new Error();
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch { throw new InvalidPaginationError("Invalid pagination cursor."); }
}

export function parseRunPagination(params: URLSearchParams): { limit: number; cursor?: RunCursor } {
  const raw = params.get("limit") ?? "20";
  if (!/^[1-9]\d{0,2}$/.test(raw) || Number(raw) > 100) throw new InvalidPaginationError("Limit must be between 1 and 100.");
  const cursor = params.get("cursor");
  return { limit: Number(raw), cursor: cursor === null ? undefined : decodeRunCursor(cursor) };
}
