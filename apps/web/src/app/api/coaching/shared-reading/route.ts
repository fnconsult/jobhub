// « Espace coach v2 » (ADR-0106): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
export async function GET() {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await readingActor();
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const at = new Date();
  const reading = getSharedReading();
  const [sessions, nextChangeAt] = await Promise.all([reading.available(actor.candidateId, at), reading.nextChange(actor.candidateId, at)]);
  return NextResponse.json({ sessions, nextChangeAt: nextChangeAt?.toISOString() ?? null }, { headers: { "cache-control": "private, no-store" } });
}
