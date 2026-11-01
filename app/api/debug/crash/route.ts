export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Failure injection is only available in development." }, { status: 404 });
  }

  setTimeout(() => process.exit(1), 250);
  return Response.json({ message: "Backend process will terminate." }, { status: 202 });
}
