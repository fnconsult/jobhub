import { randomUUID } from "node:crypto";
import { getCoachingCancellations, cancellationPolicyOn } from "@/coaching-cancellations/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The Candidate cancels one of their own Coaching Sessions: its date is cleared, so it is back under
 * « À planifier », and the cancellation is kept in its Reschedule history. Refunds are handled outside Jobbbox.
 * 200 { id } · 401 · 403 · 404 (no such session of this Candidate)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/coaching/sessions/[sessionId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  if (await cancellationPolicyOn()) {
    const body = await request.json().catch(() => ({}));
    const key = typeof body.requestKey === "string" ? body.requestKey : randomUUID();
    const result = await getCoachingCancellations().candidateCancel(candidate.id, sessionId, key);
    return NextResponse.json(result.ok ? { id: sessionId, cancellationId: result.cancellation.id } : result, {
      status: result.ok ? 200 : result.error === "not_found" ? 404 : 409,
    });
  }
  const result = await getHumanCoaches().cancelSession(candidate.id, sessionId);
  if (result.ok) return NextResponse.json({ id: result.session.id });
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
