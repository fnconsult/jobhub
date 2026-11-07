import type { OfferBoxOfferResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * One of the signed-in Candidate's Offer box entries, as the app's Work Pane opens it (#692): its Job Offer with its
 * full text, its Job Offer Summary and why it has its Match Score, against the Profile « Suivre » saves it with.
 * `:id` is the entry's id, as for its `dismissal`.
 * 200 OfferBoxOfferResponse · 401 · 404 (also anyone else's, and an entry with no Profile to be scored against)
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/offer-box/[id]">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const offer = await getCandidateReads().offerBoxOffer(candidate.id, (await params).id);
  if (!offer) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json<OfferBoxOfferResponse>(offer);
}
