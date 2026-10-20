import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { guardrailLanguage } from "@/guardrails";
import { localeOf } from "@/i18n/server";

const STATUS = { invalid: 400, not_found: 404, unavailable: 503 } as const;

/**
 * The Candidate's next message in a Coach Conversation, and the AI Coach's reply, both saved.
 * Body: { conversationId?, message, focus?: { kind: "profile" | "application" | "job_offer" | "job_search" | "job_digest", id, profileId? } };
 * without `conversationId` a new Coach Conversation starts, attached to the Profile in view (or `profileId`, the one the page shows).
 * A Guardrail message answers in the Candidate's Interface Language; `blocked` says whether the message and the reply are Blocked messages (#228).
 * A link in the message is read as a Job Offer: `jobOffer` is then the reply's Job Offer card { id, title, employer?, followed }.
 * 200 { conversation, reply, blocked: { message, reply }, jobOffer? } · 400 { error: "invalid" } · 401 · 403 · 404 { error: "not_found" } · 503 { error: "unavailable" }
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const result = await getCoachConversations().send(candidate.id, body, { language: guardrailLanguage(localeOf(candidate)) });
  if (result.ok) return NextResponse.json({ conversation: result.conversation, reply: result.reply, blocked: result.blocked, ...(result.jobOffer ? { jobOffer: result.jobOffer } : {}) });
  return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
}
