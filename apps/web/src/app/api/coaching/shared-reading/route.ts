import { NextResponse } from "next/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
export async function GET() {
  const actor = await readingActor();
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const at = new Date();
  const reading = getSharedReading();
  const [sessions, nextChangeAt] = await Promise.all([reading.available(actor.candidateId, at), reading.nextChange(actor.candidateId, at)]);
  return NextResponse.json({ sessions, nextChangeAt: nextChangeAt?.toISOString() ?? null }, { headers: { "cache-control": "private, no-store" } });
}
