import type { JobSearchResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * One of the signed-in Candidate's Job Searches (#684): where it stands and its Job Offers, best Match Score first, each
 * with its Match Score and whether the Candidate kept it. Reading it dismisses nothing: its page does, once opened.
 * 200 JobSearchResponse · 401 · 404 (also anyone else's)
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/job-searches/[id]">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobSearch = await getCandidateReads().jobSearch(candidate.id, (await params).id);
  if (!jobSearch) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json<JobSearchResponse>(jobSearch);
}
