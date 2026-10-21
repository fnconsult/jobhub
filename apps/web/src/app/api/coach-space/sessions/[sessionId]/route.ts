import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The signed-in Human Coach enters or corrects the date of one of their own Coaching Sessions, from
 * the Coach space (ADR-0027). Body: { scheduledAt (French time without an offset), durationMinutes?,
 * videoLink? (http or https) }; it replaces those three and keeps the Candidate's note. No Coach Access
 * is needed: the session is the relationship.
 * 200 { id } · 400 { errors } · 401 · 403 · 404 (not a Human Coach, retired, or not their session).
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/coach-space/sessions/[sessionId]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coaches = getHumanCoaches();
  const coach = await coaches.coachSignedIn(person);
  if (!coach) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { sessionId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  const result = await coaches.scheduleCoachedSession(coach.id, sessionId, body);
  if (result.ok) return NextResponse.json({ id: result.session.id });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: 404 });
}
