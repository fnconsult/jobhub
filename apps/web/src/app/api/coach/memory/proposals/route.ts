import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachMemory } from "@/coach-memory/server";

const STATUS = { not_found: 404, unavailable: 503 } as const;

/**
 * What the AI Coach proposes to remember from one of the Candidate's Coach Conversations. Saves nothing:
 * the Candidate confirms each proposal (POST /api/coach/memory). Body: { conversationId }.
 * 200 { proposals: [{ kind, text }] } · 401 · 403 · 404 { error: "not_found" } · 503 { error: "unavailable" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const result = await getCoachMemory().propose(candidate.id, conversationId);
  if (result.ok) return NextResponse.json({ proposals: result.proposals });
  return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
}
