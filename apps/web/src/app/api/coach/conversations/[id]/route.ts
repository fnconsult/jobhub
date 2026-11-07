import type { CoachConversationResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";
import { getCoachConversations } from "@/coach-conversations/server";

type Context = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * One of the Candidate's Coach Conversations, with its messages and its Context bar's figures (`context`, #607):
 * { messages, tokens, limits, split, upgrade, reply }, the Coach context limits of the Candidate's Plan, the latest reply's split (#731), the Plan above to name once nearly full (#732)
 * and what the latest reply sent in all its AI calls (#790). Each AI Coach reply carries `sent`, what it sent in all its AI calls (#805)
 * { calls, turns, rounds, inputTokens, cachedInputTokens, outputTokens }, tokens only, or null for one saved before #791.
 * 200 CoachConversationResponse · 401 · 404
 */
export async function GET(_request: Request, { params }: Context) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const read = await getCandidateReads().coachConversation(candidate.id, (await params).id);
  return read ? NextResponse.json<CoachConversationResponse>(read) : notFound();
}

/** Renames a Coach Conversation. Body: { title }. 200 { conversation } · 400 { error: "invalid" } · 401 · 403 · 404 */
export async function PATCH(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => undefined);
  const result = await getCoachConversations().rename(candidate.id, (await params).id, body?.title);
  if (result.ok) return NextResponse.json({ conversation: result.conversation });
  return result.error === "invalid" ? NextResponse.json({ error: "invalid" }, { status: 400 }) : notFound();
}

/** Deletes a Coach Conversation and its messages. 204 · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: Context) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return (await getCoachConversations().delete(candidate.id, (await params).id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
