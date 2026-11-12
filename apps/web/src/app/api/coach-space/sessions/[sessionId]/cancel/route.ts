import { randomUUID } from "node:crypto";
import { getCoachingCancellations, cancellationPolicyOn } from "@/coaching-cancellations/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";

/**
 * The signed-in Human Coach cancels one of their own Coaching Sessions: its date is cleared, so the
 * Candidate sees it back under « À planifier », and the cancellation is kept in its Reschedule history as theirs.
 * 200 { id } · 401 · 403 · 404 (not a Human Coach, retired, or not their session)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/coach-space/sessions/[sessionId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coaches = getHumanCoaches();
  const coach = await coaches.coachSignedIn(person);
  if (!coach) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { sessionId } = await params;
  // « Espace coach v2 » off (ADR-0106): no cancellation policy, the session is simply left undated.
  if (coachSpaceV2On() && (await cancellationPolicyOn())) {
    const body = await request.json().catch(() => ({}));
    const key = typeof body.requestKey === "string" ? body.requestKey : randomUUID();
    const result = await getCoachingCancellations().coachCancel(coach.id, sessionId, typeof body.reason === "string" ? body.reason : "", key);
    return NextResponse.json(result.ok ? { id: sessionId, cancellationId: result.cancellation.id } : result, {
      status: result.ok ? 200 : result.error === "not_found" ? 404 : 409,
    });
  }
  const result = await coaches.cancelCoachedSession(coach.id, sessionId);
  if (result.ok) return NextResponse.json({ id: sessionId });
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
