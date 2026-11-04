import type { CoachingResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * Mes coachs humains (#684): the Human Coaches (whether the signed-in Candidate granted each Coach Access), their
 * Coaching Sessions, dated or to schedule, and the price of one for them (null when it cannot be read).
 * 200 CoachingResponse · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json<CoachingResponse>(await getCandidateReads().coaching(candidate.id));
}
