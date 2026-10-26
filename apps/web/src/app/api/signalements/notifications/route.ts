import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getSignalements } from "@/signalements/server";

/**
 * The signed-in Candidate's Signalement notifications not closed yet (#377), newest first: what every workspace page
 * asks on each page change, never polled.
 * 200 { notifications: SignalementNotification[] } · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ notifications: await getSignalements().notifications(candidate.id) }, { headers: { "cache-control": "no-store" } });
}
