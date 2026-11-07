import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getOfferBox } from "@/offer-box/server";

/**
 * « Plus tard » on one of the signed-in Candidate's Offer box entries (ADR-0090, #817): out of sight until the next
 * Monday 00:00 Paris time, when it comes back under « Aujourd'hui ». Not a decision: it stays à traiter and in the count.
 * No body: there is no date to pick.
 * 200 { laterUntil } · 401 · 403 · 404 · 409 { error: "followed" | "dismissed" }
 */
export async function POST(request: Request, { params }: RouteContext<"/api/offer-box/[id]/later">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const later = await getOfferBox().later(candidate.id, (await params).id);
  if (later.ok) return NextResponse.json({ laterUntil: later.laterUntil.toISOString() });
  return NextResponse.json({ error: later.error }, { status: later.error === "not_found" ? 404 : 409 });
}

/** The « Plus tard » notice's « Annuler »: the entry back à traiter at once. 204 · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/offer-box/[id]/later">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const back = await getOfferBox().cancelLater(candidate.id, (await params).id);
  return back.ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: back.error }, { status: 404 });
}
