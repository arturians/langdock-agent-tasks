import { listDocuments, resetDocuments } from "@/lib/fake-external-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ documents: await listDocuments() });
}

export async function DELETE(): Promise<Response> {
  await resetDocuments();
  return new Response(null, { status: 204 });
}
