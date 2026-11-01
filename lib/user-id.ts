export const USER_ID_HEADER = "X-User-Id";
export const USER_ID_STORAGE_KEY = "agent-user-id";

/** Canonical UUIDs keep manually entered and generated identities consistent. */
export function parseUserId(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized : null;
}

export function requestUserId(request: Request): string | null {
  return parseUserId(request.headers.get(USER_ID_HEADER));
}
