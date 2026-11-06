import type { OfferBoxResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The Offer box (« Offres à traiter », ADR-0090, #815): every Offer box entry of the signed-in Candidate, the most recent
 * first Arrival first, each with its Job Offer, Profile, Match Score, Arrival sources and where it stands, with how many
 * are à traiter and today's day in French time. « Suivre » is `POST /api/applications`.
 * 200 OfferBoxResponse · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json<OfferBoxResponse>(await getCandidateReads().offerBox(candidate.id));
}
