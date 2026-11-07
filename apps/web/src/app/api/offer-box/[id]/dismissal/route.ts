import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getOfferBox } from "@/offer-box/server";

/**
 * « Écarter » one of the signed-in Candidate's Offer box entries (ADR-0090, #816), with an optional Dismissal reason.
 * Body: { reason?: "not_for_me" | "salary" | "location" | "contract" | "applied_elsewhere" | null }.
 * 204 · 400 { error: "invalid_reason" } · 401 · 403 · 404 · 409 { error: "followed" } (« Suivie »: undone only by deleting its Application)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/offer-box/[id]/dismissal">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => ({}));
  const reason = body && typeof body === "object" && "reason" in body ? body.reason : null;
  const decided = await getOfferBox().dismiss(candidate.id, (await params).id, { reason });
  if (decided.ok) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ error: decided.error }, { status: decided.error === "invalid_reason" ? 400 : decided.error === "followed" ? 409 : 404 });
}

/** « Revenir sur ce choix » (and the toast's « Annuler »): the entry écartée is à traiter again. 204 · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/offer-box/[id]/dismissal">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const undone = await getOfferBox().reconsider(candidate.id, (await params).id);
  return undone.ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: undone.error }, { status: 404 });
}
