/**
 * The conversation window: the AI Coach answers from the most recent messages
 * of a Coach Conversation, however long it has grown. Coach Conversations read
 * only this window from the database, and the AI Coach trims to it rather than
 * refusing a longer conversation. No server-only imports: the Coach Panel and
 * the worker (which purges Coach Conversations) bundle it.
 */

import { DEFAULT_COACH_CONTEXT_LIMITS, type CoachContextLimits, type Provenance } from "@jobhub/shared";

export interface CoachMessage {
  from: "candidate" | "coach";
  text: string;
  /**
   * On a saved AI Coach reply: what served it (#327), read from what was stored with it, a partial one for a reply saved
   * before Provenance was kept, or null when nothing was (« modèle non enregistré »). Never given to the AI Coach.
   */
  provenance?: Provenance | null;
  /** On a saved AI Coach reply: when it was saved, an ISO date, for the hour its Provenance line shows. */
  at?: string;
  /** A Blocked message (#228): a Candidate message a Guardrail stopped, or the Guardrail message that answered it or replaced a reply. Which Guardrail is never said. */
  blocked?: true;
  /** On an AI Coach reply to a Job Offer link: the Job Offer card it shows. Never given to the AI Coach. */
  jobOffer?: JobOfferCard;
}

/**
 * A Job Offer card: the Job Offer an AI Coach reply read from a link the Candidate pasted, linking to its
 * page. To process until the Candidate follows it (`followed`: they saved it as an Application), which
 * gives it its Match Score and At a glance.
 */
export interface JobOfferCard {
  id: string;
  title: string;
  employer?: string;
  followed: boolean;
}

/** Longest single message. */
export const MAX_MESSAGE_LENGTH = 5000;
/** Most messages the AI Coach answers from, on a Plan with no Coach context limits stored (ADR-0078): its Plan's `coachContextMessages` otherwise. */
export const MAX_MESSAGES = DEFAULT_COACH_CONTEXT_LIMITS.coachContextMessages;

/**
 * The ceiling of the AI Coach's context, in estimated tokens, on a Plan with no Coach context limits stored (ADR-0078): its Plan's
 * `coachContextTokens` otherwise. What it is told of the Candidate is fitted under it.
 */
export const COACH_CONTEXT_MAX_TOKENS = DEFAULT_COACH_CONTEXT_LIMITS.coachContextTokens;

/** A rough token count (about 4 characters per token), enough to keep the context under its cap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * What the context of an AI Coach reply is made of (ADR-0078), as the Context bar's breakdown names it: Messages (those the AI
 * Coach read), Instructions du coach (its persona, rules and the Playbook digest), Profil et CV (what it is told of the Candidate),
 * Conseils des agents (the Playbook Agents' advice) and Sources (those the knowledge cites).
 */
export const CONTEXT_CATEGORIES = ["messages", "instructions", "profile", "advice", "sources"] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

/** The estimate (estimateTokens) of a reply's context split by category: it adds up to the reply's whole estimate. */
export type ContextSplit = Record<ContextCategory, number>;

/**
 * What the server says of a Coach Conversation for its Context bar (#607): its `messages`, and `tokens`, the estimate
 * (estimateTokens) of the context sent with its latest reply: the AI Coach's system text and the messages it read;
 * `split`, that estimate by category (#731, null when none was kept), and `limits`, the Coach context limits of the
 * Candidate's Plan (ADR-0078). The last two may be absent from what a page was given before them.
 */
export type ConversationContext = { messages: number; tokens: number; limits?: CoachContextLimits; split?: ContextSplit | null };

/** From this share of either limit, the Context bar says the AI Coach reads only the latest messages. */
const NEARLY_FULL = 0.8;

/**
 * The Context bar (ADR-0070): its figures, out of the Coach context limits (null when unlimited), the share it is filled to
 * (that of the limit nearer reached, at most 1; an unlimited one never fills it), and whether it is nearly full.
 */
export type ContextBar = Pick<ConversationContext, "messages" | "tokens"> & { maxMessages: number | null; maxTokens: number | null; share: number; nearlyFull: boolean };

/**
 * The Context bar of a conversation, from what the server says of it, out of the Coach context limits of the Candidate's Plan
 * it says (ADR-0078), else a Plan's with none stored; empty for one not yet started (null).
 */
export function contextBar(context: ConversationContext | null): ContextBar {
  const { messages, tokens } = context ?? { messages: 0, tokens: 0 };
  const { coachContextMessages: maxMessages, coachContextTokens: maxTokens } = context?.limits ?? DEFAULT_COACH_CONTEXT_LIMITS;
  const filled = (count: number, max: number | null) => (max === null ? 0 : max === 0 ? 1 : count / max);
  const share = Math.min(1, Math.max(filled(messages, maxMessages), filled(tokens, maxTokens)));
  return { messages, maxMessages, tokens, maxTokens, share, nearlyFull: share >= NEARLY_FULL };
}

/** The last `limit` messages (all of them when null: unlimited), starting with a Candidate message. */
export function recentConversation<T extends CoachMessage>(messages: readonly T[], limit: number | null = MAX_MESSAGES): T[] {
  const recent = limit === null ? messages.slice() : limit > 0 ? messages.slice(-limit) : [];
  const start = recent.findIndex((message) => message.from === "candidate");
  return start === -1 ? [] : recent.slice(start);
}
