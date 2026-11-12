// « Espace coach v2 » (ADR-0107): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachingTimeZones } from "@/coaching-time/server";

export async function PUT(request: Request) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const saved = await getCoachingTimeZones().saveCandidate(person.id, body?.timeZone);
  return NextResponse.json(saved ? { ok: true } : { error: "invalid" }, { status: saved ? 200 : 400 });
}
