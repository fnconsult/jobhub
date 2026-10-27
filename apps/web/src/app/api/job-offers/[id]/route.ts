import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getJobOffers } from "@/job-offers/server";

/**
 * A Job Offer. Job Offers are not personal data and need no account, except a private one (ADR-0049): only its
 * Candidate gets it, anyone else a 404 as if there were none. 200 JobOffer · 404
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/job-offers/[id]">) {
  const candidate = await getCurrentCandidate();
  const jobOffer = await getJobOffers().get((await params).id, candidate?.id);
  if (!jobOffer) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(jobOffer);
}
