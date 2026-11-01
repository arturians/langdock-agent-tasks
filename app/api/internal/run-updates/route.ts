import { openDatabase } from "@/lib/db";
import { parseUserId } from "@/lib/user-id";
import { publishRunUpdate } from "@/lib/run-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A wake-up only: caller cannot supply event data, ownership, or change task state.
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const userId = parseUserId(typeof body?.userId === "string" ? body.userId : null);
  const runId = parseUserId(typeof body?.runId === "string" ? body.runId : null);
  const stepId = parseUserId(typeof body?.stepId === "string" ? body.stepId : null);
  if (!userId || !runId || !stepId) return Response.json({ error: "Valid userId, runId and stepId are required." }, { status: 400 });
  const db = openDatabase();
  try {
    const step = db.prepare("SELECT id FROM run_steps WHERE id = ? AND run_id = ? AND user_id = ?").get(stepId, runId, userId);
    if (!step) return Response.json({ error: "Step not found for this run and user." }, { status: 404 });
    publishRunUpdate(userId, runId, stepId);
    return new Response(null, { status: 204 });
  } finally { db.close(); }
}
