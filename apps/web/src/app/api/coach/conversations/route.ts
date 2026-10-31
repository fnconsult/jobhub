import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";

/**
 * The Candidate's Coach Conversations, most recently active first. 200 { conversations } · 401
 *
 * With a Subject, `?kind=application|profile|job_search|job_digest&id=<its id>` or `?kind=menu&id=applications|jobSearches|jobDigests|agenda|humanCoaches`
 * (ADR-0070, #600): that Subject's conversation with its messages, or null until its first message (it is never created empty).
 * 200 { conversation } · 400 { error: "invalid" } · 401 · 404 { error: "not_found" } (not the Candidate's)
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  if (kind === null) return NextResponse.json({ conversations: await getCoachConversations().list(candidate.id) });
  const result = await getCoachConversations().ofSubject(candidate.id, { kind, id: query.get("id") });
  if (result.ok) return NextResponse.json({ conversation: result.conversation });
  return NextResponse.json({ error: result.error }, { status: result.error === "invalid" ? 400 : 404 });
}
