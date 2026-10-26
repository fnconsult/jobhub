import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getSignalements } from "@/signalements/server";

/**
 * Deletes one of the signed-in Candidate's Signalements (« Mes signalements », #377): gone for the team too; the Back
 * Office Audit keeps only what it already held. 204 · 401 · 403 · 404 (none of theirs)
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/signalements/[id]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await getSignalements().remove(candidate.id, (await params).id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
