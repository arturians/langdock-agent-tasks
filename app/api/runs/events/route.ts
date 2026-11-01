import { openDatabase } from "@/lib/db";
import { listUserRuns } from "@/lib/run-store";
import { requestUserId } from "@/lib/user-id";
import { snapshotStream } from "@/lib/sse-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  const db = openDatabase();
  return snapshotStream({ request, userId, read: () => ({ runs: listUserRuns(db, userId) }), close: () => db.close() });
}
