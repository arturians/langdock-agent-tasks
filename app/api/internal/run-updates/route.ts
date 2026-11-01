import { openDatabase } from "@/lib/db";
import { parseUserId } from "@/lib/user-id";
import { publishRunUpdate } from "@/lib/run-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A wake-up only: caller cannot supply event data, ownership, or change task state.
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const runId = parseUserId(typeof body?.runId === "string" ? body.runId : null);
  if (!runId) return Response.json({ error: "A valid runId is required." }, { status: 400 });
  const db = openDatabase();
  try {
    const run = db.prepare("SELECT user_id FROM runs WHERE id = ?").get(runId);
    if (run) publishRunUpdate(run.user_id as string, runId);
    return new Response(null, { status: 204 });
  } finally { db.close(); }
}
