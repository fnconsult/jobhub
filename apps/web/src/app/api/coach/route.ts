import { NextResponse } from "next/server";
import { stepLabel } from "@jobhub/shared";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";
import type { CoachEvent, SendResult } from "@/coach-conversations";
import { guardrailLanguage } from "@/guardrails";
import { localeOf } from "@/i18n/server";
import { ndjsonResponse } from "@/ndjson";

/** 499: the Candidate stopped the reply (#328), as proxies log a request its client closed. */
const STATUS = { invalid: 400, not_found: 404, unavailable: 503, stopped: 499 } as const;

/**
 * The Candidate's next message in a Coach Conversation, and the AI Coach's reply, both saved.
 * Body: { conversationId?, message, focus?: { kind: "profile" | "application" | "job_offer" | "job_search" | "job_digest", id, profileId? } };
 * without `conversationId` a new Coach Conversation starts, attached to the Profile in view (or `profileId`, the one the page shows).
 * A Guardrail message answers in the Candidate's Interface Language; `blocked` says whether the message and the reply are Blocked messages (#228).
 * A link in the message is read as a Job Offer: `jobOffer` is then the reply's Job Offer card { id, title, employer?, followed }.
 * `provenance` says what served the reply (#327) and `at` when it was saved, for the line under it.
 * 200 { conversation, reply, blocked: { message, reply }, jobOffer?, provenance, at } · 400 { error: "invalid" } · 401 · 403 · 404 { error: "not_found" }
 * · 503 { error: "unavailable", reason } (its Failure Reason, never the technical message) · 499 { error: "stopped", conversation }.
 *
 * Live (#328), with `Accept: application/x-ndjson`: 200, one JSON event per line as the reply runs:
 *   { type: "conversation", conversation }      the conversation the message goes to (a new one is named already)
 *   { type: "step_started", id, step, label }   a step starts: its Activity (`step.activity`) and what it is called (`label`, see stepLabel)
 *   { type: "step_ended", id, step }            it ends: its tokens, time and Outcome
 * then one of { type: "reply", ...the 200 body } · { type: "failed", error, reason? } · { type: "stopped", conversation }.
 * Aborting the request is the Stop: every AI call of the reply is aborted, and only the Candidate's message is saved.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const send = (signal: AbortSignal, onEvent?: (event: CoachEvent) => void) =>
    getCoachConversations().send(candidate.id, body, { language: guardrailLanguage(localeOf(candidate)), signal, ...(onEvent ? { onEvent } : {}) });

  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    return ndjsonResponse(request.signal, async (write, signal) => {
      const result = await send(signal, (event) => write(event.type === "step_started" ? { ...event, label: stepLabel(event.step) } : event));
      write(finalEvent(result));
    });
  }
  const result = await send(request.signal);
  if (result.ok) return NextResponse.json(replyOf(result));
  return NextResponse.json(failureOf(result), { status: STATUS[result.error] });
}

function replyOf({ conversation, reply, blocked, jobOffer, provenance, at }: Extract<SendResult, { ok: true }>) {
  return { conversation, reply, blocked, ...(jobOffer ? { jobOffer } : {}), provenance, at };
}

function failureOf(result: Extract<SendResult, { ok: false }>) {
  if (result.error === "stopped") return { error: result.error, conversation: result.conversation };
  if (result.error === "unavailable") return { error: result.error, reason: result.reason };
  return { error: result.error };
}

/** The stream's last event: the reply, its failure, or the Stop. */
function finalEvent(result: SendResult) {
  if (result.ok) return { type: "reply", ...replyOf(result) };
  return { type: result.error === "stopped" ? "stopped" : "failed", ...failureOf(result) };
}
