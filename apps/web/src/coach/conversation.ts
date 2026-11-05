/**
 * The conversation window: the AI Coach answers from the most recent messages
 * of a Coach Conversation, however long it has grown. Coach Conversations read
 * only this window from the database, and the AI Coach trims to it rather than
 * refusing a longer conversation. No server-only imports: the Coach Panel and
 * the worker (which purges Coach Conversations) bundle it.
 */

import { DEFAULT_COACH_CONTEXT_LIMITS, type Provenance } from "@jobhub/shared";
import type { CoachProposalCard } from "../coach-proposals/card";

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
  /** On a saved AI Coach reply: the Action Cards of the Coach proposals it made (#715), under it. Never given to the AI Coach. */
  cards?: CoachProposalCard[];
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

export { CONTEXT_CATEGORIES, contextBar, type ContextBar, type ContextCategory, type ContextSplit, type ConversationContext } from "@jobhub/shared";

/** The last `limit` messages (all of them when null: unlimited), starting with a Candidate message. */
export function recentConversation<T extends CoachMessage>(messages: readonly T[], limit: number | null = MAX_MESSAGES): T[] {
  const recent = limit === null ? messages.slice() : limit > 0 ? messages.slice(-limit) : [];
  const start = recent.findIndex((message) => message.from === "candidate");
  return start === -1 ? [] : recent.slice(start);
}
