import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getFollowUps } from "@/follow-ups/server";

/**
 * The Candidate's Follow-up Delays, in working days.
 * Body: { afterApplied, afterFollowUp }.
 * 200 { afterApplied, afterFollowUp } · 400 { errors: FieldError[] } · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await getFollowUps().setDelays(candidate.id, await request.json().catch(() => undefined));
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json(result.delays);
}
