/**
 * The AI Coach's reply to the Candidate's next message, as the web's Coach Conversation reads it
 * (apps/web/src/components/CoachConversationPage.tsx): `POST /api/coach` with `Accept: application/x-ndjson`, one JSON
 * event per line as the reply runs (the conversation the message goes to, each step started and ended), then the reply,
 * its failure, or its Stop (the route's own comment holds the contract).
 *
 *   const outcome = await askCoach(api, { conversationId, message }, { signal: stop.signal, onLive: setLive });
 *
 * The stream's chunks are cut anywhere, a line or a character included: the reader keeps the partial line for the next
 * chunk and decodes bytes as a stream. Aborting `signal` is « Arrêter »: the server aborts every AI call of the reply
 * and keeps only the Candidate's message, in the conversation the stream named. Never throws: every way it can end is
 * an outcome.
 */
import { isFailureReason, type Activity, type FailureReason, type Provenance, type StepLabel } from "@jobhub/shared";
import type { coachProposalCardSchema } from "@jobhub/shared/reads";
import type * as z from "zod";
import type { Api } from "../api/api";

/** A saved Coach Conversation, as the stream and the drawer name it. */
export type ConversationSummary = { id: string; title: string; lastMessageAt?: string };
/** Its Context bar's figures once a message is saved (#607): its messages and the jetons of the context sent. */
export type ConversationContext = { messages: number; tokens: number };
export type CoachProposalCard = z.infer<typeof coachProposalCardSchema>;

/** What a page's conversation is about (ADR-0070): one of the Candidate's objects, or a Sidebar menu. */
export type SubjectRef = { kind: "application" | "profile" | "job_search" | "job_digest" | "menu"; id: string };

/** What goes with the Candidate's message (the route's body). */
export type CoachRequest = {
  /** The saved conversation it goes to; with neither this nor `subject`, a new Free conversation. */
  conversationId?: string;
  /** The Subject whose conversation it goes to, started by this message if it has none. */
  subject?: SubjectRef;
  message: string;
  /** The Help Article read just before asking: the AI Coach is told its title alone (#342). */
  helpArticle?: { id: string; title: string };
  /** The page in view (#344). */
  route?: string;
};

/** The reply, as the route's last event gives it. */
export type CoachReply = {
  conversation: ConversationSummary;
  reply: string;
  blocked?: { message?: boolean; reply?: boolean };
  jobOffer?: { id: string; title: string; employer?: string; followed: boolean };
  provenance?: Provenance | null;
  at?: string;
  couldNotAnswer?: boolean;
  context?: ConversationContext;
  cards?: CoachProposalCard[];
  proposalsDisplay?: string;
};

/** The reply on its way: the step under way (its Activity and what it is called), and the jetons spent so far. */
export type Live = { step: { activity: Activity; label: StepLabel } | null; tokens: number };

export type CoachOutcome =
  | { kind: "reply"; reply: CoachReply }
  /** « Arrêter », or the server stopped it: the question is saved in `conversation`, « Réponse arrêtée » stands for the reply. */
  | { kind: "stopped"; conversation: ConversationSummary | null; context: ConversationContext | null; spent: { tokens: number; ms: number } }
  /** No reply: its Failure Reason when the server gave one the app words. */
  | { kind: "failed"; reason: FailureReason | null }
  /** The message was refused (too long, empty). */
  | { kind: "invalid" }
  /** The conversation was deleted meanwhile: the message starts a new one. */
  | { kind: "gone" };

type Event =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "step_started"; id: number; step: { activity: Activity }; label: StepLabel }
  | { type: "step_ended"; id: number; step: { kind: string; tokens?: { input: number; output: number } } }
  | ({ type: "reply" } & CoachReply)
  | { type: "stopped"; conversation?: ConversationSummary; context?: ConversationContext }
  | { type: "failed"; error?: string; reason?: unknown };

const failure = (error: unknown, reason: unknown): CoachOutcome =>
  error === "invalid" ? { kind: "invalid" } : error === "not_found" ? { kind: "gone" } : { kind: "failed", reason: isFailureReason(reason) ? reason : null };

export async function askCoach(api: Api, request: CoachRequest, { signal, onLive }: { signal?: AbortSignal; onLive?: (live: Live) => void } = {}): Promise<CoachOutcome> {
  const startedAt = Date.now();
  let conversation: ConversationSummary | null = null;
  let live: Live = { step: null, tokens: 0 };
  let ended: CoachOutcome | null = null;
  const stopped = (context: ConversationContext | null = null): CoachOutcome => ({
    kind: "stopped",
    conversation,
    context,
    spent: { tokens: live.tokens, ms: Date.now() - startedAt },
  });

  const onEvent = (event: Event) => {
    if (ended) return;
    if (event.type === "conversation") conversation = event.conversation;
    else if (event.type === "step_started") {
      live = { ...live, step: { activity: event.step.activity, label: event.label } };
      onLive?.(live);
    } else if (event.type === "step_ended") {
      const tokens = event.step.kind === "ai" && event.step.tokens ? event.step.tokens.input + event.step.tokens.output : 0;
      live = { ...live, tokens: live.tokens + tokens };
      onLive?.(live);
    } else if (event.type === "reply") {
      ended = { kind: "reply", reply: event };
    } else if (event.type === "stopped") {
      conversation = event.conversation ?? conversation;
      ended = stopped(event.context ?? null);
    } else if (event.type === "failed") ended = failure(event.error, event.reason);
  };

  try {
    const response = await api.fetch("/api/coach", { method: "POST", headers: { accept: "application/x-ndjson" }, body: JSON.stringify(request), ...(signal ? { signal } : {}) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; reason?: unknown };
      return response.status === 401 ? failure(null, null) : failure(body.error, body.reason);
    }
    await readNdjson(response, (line) => onEvent(line as Event));
    // A stream that ends without its last event was cut short.
    return ended ?? (signal?.aborted ? stopped() : { kind: "failed", reason: null });
  } catch {
    return ended ?? (signal?.aborted ? stopped() : { kind: "failed", reason: null });
  }
}

/**
 * Each JSON line of `response`'s body, in order, as soon as it is whole; the last one even without its newline. A line
 * that is not JSON is skipped. A body the platform cannot stream (React Native's own fetch) is read whole.
 */
async function readNdjson(response: Response, onLine: (value: unknown) => void): Promise<void> {
  const emit = (line: string) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    onLine(value);
  };
  if (!response.body) {
    (await response.text()).split("\n").forEach(emit);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(emit);
    if (done) break;
  }
  emit(pending);
}
