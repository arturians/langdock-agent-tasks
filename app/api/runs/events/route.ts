import { openDatabase } from "@/lib/db";
import { decodeRunCursor, InvalidPaginationError, parseRunPagination } from "@/lib/run-pagination";
import { readUserRunWindow } from "@/lib/run-store";
import { requestUserId } from "@/lib/user-id";
import { snapshotStream } from "@/lib/sse-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  try {
    const params = new URL(request.url).searchParams;
    const { limit } = parseRunPagination(params);
    const through = params.has("through") ? decodeRunCursor(params.get("through")!) : undefined;
    const db = openDatabase();
    return snapshotStream({ request, userId, read: () => readUserRunWindow(db, userId, limit, through), close: () => db.close() });
  } catch (error) {
    if (error instanceof InvalidPaginationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
