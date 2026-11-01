import { openDatabase } from "@/lib/db";
import { requestUserId } from "@/lib/user-id";
import { parseChangeCursor, runChangeStream } from "@/lib/run-change-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = requestUserId(request);
  if (!userId) return Response.json({ error: "A valid UUID in X-User-Id is required." }, { status: 400 });
  const raw = new URL(request.url).searchParams.get("after");
  let after: number | undefined;
  try { after = raw === null ? undefined : parseChangeCursor(raw); }
  catch { return Response.json({ error: "Invalid change cursor." }, { status: 400 }); }
  return runChangeStream({ db: openDatabase(), request, userId, after });
}
