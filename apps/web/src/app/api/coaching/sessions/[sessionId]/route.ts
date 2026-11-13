import { coachSpaceV2On } from "@/coach-space-v2/server";
import {linkedBookingConflict} from "@/coaching-booking/manual";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The Candidate enters or edits the date of one of their own Coaching Sessions, booked on the
 * Human Coach's Cal.com page (ADR-0027). Body: { scheduledAt (French time without an offset),
 * durationMinutes?, videoLink? (http or https), note? }; only supplied optional fields change.
 * 200 { id } · 400 { errors } · 401 · 403 · 404 (no such session of this Candidate) · 409 { error: "too_late" } (the
 * session has ended: « Espace coach v2 » on, #1019, and off, #1022) · 409 { error: "use_cal" } (on: booked in Cal.com).
 * There is no DELETE: a Candidate never deletes a Coaching Session.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/coaching/sessions/[sessionId]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  let result;
  // A booking linked to Cal.com is changed there (« Espace coach v2 », ADR-0107); off, as before the Human Coach epic.
  if (!coachSpaceV2On()) result = await getHumanCoaches().scheduleSession(candidate.id, sessionId, body);
  else try{result=await getHumanCoaches().scheduleSession(candidate.id, sessionId, body);}catch(error){if(linkedBookingConflict(error))return NextResponse.json({error:"use_cal"},{status:409});throw error;}
  if (result.ok) return NextResponse.json({ id: result.session.id });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  // A session that has ended is not moved, as « trop tard » (#883): « Espace coach v2 » on (#1019) and off (#1022).
  if (result.error === "too_late") return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ error: result.error }, { status: 404 });
}
