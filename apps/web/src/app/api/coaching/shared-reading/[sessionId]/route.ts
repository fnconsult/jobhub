// « Espace coach v2 » (ADR-0107): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { isFromTrustedOrigin } from "@/auth/server";
import { readingActor } from "@/shared-reading/actor";
import { candidateReadingSources, getSharedReading } from "@/shared-reading/server";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(_request: Request, { params }: Context) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await readingActor();
  const { sessionId } = await params;
  const reading = getSharedReading();
  if (!actor || !(await reading.canUse(actor, sessionId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Sources are a Candidate's own list, never supplied to the Human Coach through this route.
  const sessions = await reading.available(actor.candidateId);
  return NextResponse.json(
    { sources: sessions.some((session) => session.id === sessionId) ? await candidateReadingSources(actor.candidateId) : [] },
    { headers: { "cache-control": "private, no-store" } },
  );
}
export async function POST(request: Request, { params }: Context) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const actor = await readingActor();
  if (!actor) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { sessionId } = await params;
  const body = await request.json().catch(() => null);
  const reading = getSharedReading();
  if (body?.action === "stop") return NextResponse.json({ ok: await reading.stop(actor, sessionId) });
  if (body?.action === "move") {
    const ok = typeof body.shareId === "string" && (await reading.move(actor, sessionId, body.shareId, body));
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }
  const state = await reading.startCandidate(actor, sessionId, body?.source);
  return NextResponse.json(state ? { state } : { error: "not_found" }, { status: state ? 200 : 404 });
}
