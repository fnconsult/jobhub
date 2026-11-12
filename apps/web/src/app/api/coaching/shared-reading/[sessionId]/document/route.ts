// « Espace coach v2 » (ADR-0106): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await readingActor();
  const { sessionId } = await params;
  const shareId = new URL(request.url).searchParams.get("share") ?? "";
  const found = actor ? await getSharedReading().document(actor, sessionId, shareId) : null;
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "private, no-store" } });
  if (found.document.kind === "pdf" && found.pdf)
    return new Response(new Uint8Array(found.pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  return NextResponse.json(found.document, { headers: { "cache-control": "private, no-store" } });
}
