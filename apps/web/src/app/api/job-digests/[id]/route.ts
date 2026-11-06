import type { JobDigestResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * One of the signed-in Candidate's Job Digests sent and its Job Offers, best Match Score first, each with its Match
 * Score and whether the Candidate followed it (#692): what the app opens a Job Digest on.
 * 200 JobDigestResponse · 401 · 404 (also anyone else's)
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/job-digests/[id]">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobDigest = await getCandidateReads().jobDigest(candidate.id, (await params).id);
  if (!jobDigest) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json<JobDigestResponse>(jobDigest);
}
