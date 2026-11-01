import { InvalidPaginationError, parseRunPagination } from "@/lib/run-pagination";
import { publishRunUpdate } from "@/lib/run-notifications";
import { firstStep } from "@/lib/agent";
import { requestUserId } from "@/lib/user-id";
import { openDatabase } from "@/lib/db";
import { createRun, listUserRuns } from "@/lib/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  const db = openDatabase();
  try {
    return Response.json(listUserRuns(db, userId, parseRunPagination(new URL(request.url).searchParams)));
  } catch (error) {
    if (error instanceof InvalidPaginationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  } finally {
    db.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) {
    return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  const db = openDatabase();
  try {
    const runId = createRun(db, { userId, prompt, firstStep: firstStep(prompt) });
    publishRunUpdate(userId, runId);
    return Response.json({ runId }, { status: 202 });
  } finally {
    db.close();
  }
}
