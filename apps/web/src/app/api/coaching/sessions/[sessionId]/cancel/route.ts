import { coachSpaceV2On } from "@/coach-space-v2/server";
import { randomUUID } from "node:crypto";
import { getCoachingCancellations, cancellationPolicyOn } from "@/coaching-cancellations/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The Candidate cancels one of their own Coaching Sessions: its date is cleared, so it is back under
 * « À planifier », and the cancellation is kept in its Reschedule history. Refunds are handled outside Jobbbox.
 * 200 { id } · 401 · 403 · 404 (no such session of this Candidate) · 409 { error: "too_late" } (« Espace coach v2 »:
 * the session has ended, #1019, or is within 24 hours under the cancellation policy, #883)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/coaching/sessions/[sessionId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  // The cancellation policy is part of « Espace coach v2 » (ADR-0107): off, a cancellation is the one before it.
  if (coachSpaceV2On() && (await cancellationPolicyOn())) {
    const body = await request.json().catch(() => ({}));
    const key = typeof body.requestKey === "string" ? body.requestKey : randomUUID();
    const result = await getCoachingCancellations().candidateCancel(candidate.id, sessionId, key);
    return NextResponse.json(result.ok ? { id: sessionId, cancellationId: result.cancellation.id } : result, {
      status: result.ok ? 200 : result.error === "not_found" ? 404 : 409,
    });
  }
  const result = await getHumanCoaches().cancelSession(candidate.id, sessionId);
  if (result.ok) return NextResponse.json({ id: result.session.id });
  // « Espace coach v2 » only: a session that has ended is not cancelled (#1019), as « trop tard » (#883).
  if ("error" in result && result.error === "too_late") return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
