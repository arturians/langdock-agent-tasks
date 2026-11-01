import { openDatabase } from "@/lib/db";
import { requestUserId } from "@/lib/user-id";
import { readUserProgress } from "@/lib/run-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  const { id } = await context.params;
  const db = openDatabase();
  try {
    const progress = readUserProgress(db, userId, id);
    return progress ? Response.json(progress) : Response.json({ error: "Run not found." }, { status: 404 });
  } finally {
    db.close();
  }
}
