import type { OffersToHandleResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * How many of the signed-in Candidate's Offer box entries are à traiter now (#818, ADR-0090), without the entries: the
 * « N » of the app's « Recherches d'offres » and its icon's badge, read at each opening of the app.
 * 200 OffersToHandleResponse · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json<OffersToHandleResponse>(await getCandidateReads().offersToHandle(candidate.id));
}
