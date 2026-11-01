/**
 * The conversation window: the AI Coach answers from the most recent messages
 * of a Coach Conversation, however long it has grown. Coach Conversations read
 * only this window from the database, and the AI Coach trims to it rather than
 * refusing a longer conversation. No server-only imports: the Coach Panel and
 * the worker (which purges Coach Conversations) bundle it.
 */

import type { Provenance } from "@jobhub/shared";

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

/** Longest single message, and most messages the AI Coach answers from. */
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_MESSAGES = 40;

/** The ceiling of the AI Coach's context, in estimated tokens: what it is told of the Candidate is fitted under it. */
export const COACH_CONTEXT_MAX_TOKENS = 12_000;

/** A rough token count (about 4 characters per token), enough to keep the context under its cap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * What the server says of a Coach Conversation for its Context bar (#607): its `messages`, and `tokens`, the estimate
 * (estimateTokens) of the context sent with its latest reply: the AI Coach's system text and the messages it read.
 */
export type ConversationContext = { messages: number; tokens: number };

/** From this share of either limit, the Context bar says the AI Coach reads only the latest messages. */
const NEARLY_FULL = 0.8;

/** The Context bar (ADR-0070): its figures, the share it is filled to (that of the limit nearer reached, at most 1), and whether it is nearly full. */
export type ContextBar = ConversationContext & { maxMessages: number; maxTokens: number; share: number; nearlyFull: boolean };

/** The Context bar of a conversation, from what the server says of it; empty for one not yet started (null). */
export function contextBar(context: ConversationContext | null): ContextBar {
  const { messages, tokens } = context ?? { messages: 0, tokens: 0 };
  const share = Math.min(1, Math.max(messages / MAX_MESSAGES, tokens / COACH_CONTEXT_MAX_TOKENS));
  return { messages, maxMessages: MAX_MESSAGES, tokens, maxTokens: COACH_CONTEXT_MAX_TOKENS, share, nearlyFull: share >= NEARLY_FULL };
}

/** The last MAX_MESSAGES messages, starting with a Candidate message. */
export function recentConversation<T extends CoachMessage>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const start = recent.findIndex((message) => message.from === "candidate");
  return start === -1 ? [] : recent.slice(start);
}
