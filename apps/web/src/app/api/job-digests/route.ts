import type { JobDigestsResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The Job Digests' card (#684): each active Profile of the signed-in Candidate (an Archived Profile has none), how often
 * its Job Digest is sent, then every one sent, newest first. 200 JobDigestsResponse · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json<JobDigestsResponse>(await getCandidateReads().jobDigests(candidate.id));
}
