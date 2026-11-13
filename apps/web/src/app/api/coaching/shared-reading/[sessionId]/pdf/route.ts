// « Espace coach v2 » (ADR-0107): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { isFromTrustedOrigin } from "@/auth/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
import { SHARED_PDF_MAX_BYTES } from "@/shared-reading";
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const actor = await readingActor();
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (Number(request.headers.get("content-length")) > SHARED_PDF_MAX_BYTES + 65536) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const file = await request
    .formData()
    .then((form) => form.get("pdf"))
    .catch(() => null);
  if (!(file instanceof File) || file.size > SHARED_PDF_MAX_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const state = await getSharedReading().presentPdf(actor, (await params).sessionId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return NextResponse.json(state ? { state } : { error: "invalid" }, { status: state ? 200 : 400 });
}
