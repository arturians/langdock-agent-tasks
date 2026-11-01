import { openDatabase } from "@/lib/db";
import { readUserProgress } from "@/lib/run-progress";
import { requestUserId } from "@/lib/user-id";
import { snapshotStream } from "@/lib/sse-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  const { id } = await context.params;
  const db = openDatabase();
  const initial = readUserProgress(db, userId, id);
  if (!initial) { db.close(); return Response.json({ error: "Run not found." }, { status: 404 }); }
  return snapshotStream({
    request, userId, runId: id, read: () => readUserProgress(db, userId, id), close: () => db.close(),
    finished: progress => !progress || progress.status === "completed" || progress.status === "failed",
  });
}
