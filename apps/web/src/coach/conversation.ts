/**
 * The conversation window: the AI Coach answers from the most recent messages
 * of a Coach Conversation, however long it has grown. Coach Conversations read
 * only this window from the database, and the AI Coach trims to it rather than
 * refusing a longer conversation. No server-only imports: the Coach Panel and
 * the worker (which purges Coach Conversations) bundle it.
 */

import { MAX_MESSAGES, type Provenance } from "@jobhub/shared";
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

// The Context bar's limits, categories and figures, shared with the native app (#690): most messages the AI Coach answers from
// and the ceiling of its context on a Plan with none stored (ADR-0078), what a reply's context is made of, and the bar itself.
export {
  COACH_CONTEXT_MAX_TOKENS,
  CONTEXT_CATEGORIES,
  contextBar,
  MAX_MESSAGES,
  type ContextBar,
  type ContextCategory,
  type ContextSplit,
  type ConversationContext,
} from "@jobhub/shared";

/** A rough token count (about 4 characters per token), enough to keep the context under its cap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The last `limit` messages (all of them when null: unlimited), starting with a Candidate message. */
export function recentConversation<T extends CoachMessage>(messages: readonly T[], limit: number | null = MAX_MESSAGES): T[] {
  const recent = limit === null ? messages.slice() : limit > 0 ? messages.slice(-limit) : [];
  const start = recent.findIndex((message) => message.from === "candidate");
  return start === -1 ? [] : recent.slice(start);
}
