import { NextResponse } from "next/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
export async function GET() {
  const actor = await readingActor();
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ sessions: await getSharedReading().available(actor.candidateId) }, { headers: { "cache-control": "private, no-store" } });
}
