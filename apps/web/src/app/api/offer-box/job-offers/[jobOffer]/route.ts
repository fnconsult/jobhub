import type { OfferBoxEntryOfResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The signed-in Candidate's Offer box entry of one Job Offer (#895), as `GET /api/offer-box` gives its entries, however
 * long ago it was écartée: the Work Pane of a Job Offer a Job Search or a Job Digest found reads it to say what was
 * decided, where « Écartées » in the Offer box keeps its 30 days. `:jobOffer` is the Job Offer's id.
 * 200 OfferBoxEntryOfResponse · 401 · 404 (no entry of it, also anyone else's)
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/offer-box/job-offers/[jobOffer]">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const entry = await getCandidateReads().offerBoxEntryOf(candidate.id, (await params).jobOffer);
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json<OfferBoxEntryOfResponse>(entry);
}
