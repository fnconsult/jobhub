import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getJobSearches } from "@/job-searches/server";

/**
 * The signed-in Candidate's Job Search notifications not dismissed yet, and
 * whether one of their Job Searches is still searching, and those searching with
 * their live steps (#330): every page polls it every 1.5 s while one is.
 * 200 { notifications, searching, running } · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getJobSearches().notifications(candidate.id), { headers: { "cache-control": "no-store" } });
}
