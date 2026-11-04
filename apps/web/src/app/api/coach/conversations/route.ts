import type { CoachConversationResponse, CoachConversationsResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The Candidate's Coach Conversations, most recently active first; `?free=1`, the Free conversations alone (the app's
 * drawer, #684). 200 CoachConversationsResponse · 401
 *
 * With a Subject, `?kind=application|profile|job_search|job_digest&id=<its id>` or `?kind=menu&id=applications|jobSearches|jobDigests|agenda|humanCoaches`
 * (ADR-0070, #600): that Subject's conversation with its messages, or null until its first message (it is never created empty).
 * 200 CoachConversationResponse · 400 { error: "invalid" } · 401 · 404 { error: "not_found" } (not the Candidate's)
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  if (kind === null) return NextResponse.json<CoachConversationsResponse>(await getCandidateReads().coachConversations(candidate.id, { free: query.get("free") === "1" }));
  const result = await getCandidateReads().coachConversationOfSubject(candidate.id, { kind, id: query.get("id") });
  if ("conversation" in result) return NextResponse.json<CoachConversationResponse>(result);
  return NextResponse.json({ error: result.error }, { status: result.error === "invalid" ? 400 : 404 });
}
