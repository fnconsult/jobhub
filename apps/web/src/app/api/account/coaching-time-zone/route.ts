import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachingTimeZones } from "@/coaching-time/server";

export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const saved = await getCoachingTimeZones().saveCandidate(person.id, body?.timeZone);
  return NextResponse.json(saved ? { ok: true } : { error: "invalid" }, { status: saved ? 200 : 400 });
}
