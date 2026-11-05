/**
 * The Context bar (#607, ADR-0070): how much of a Coach Conversation the AI Coach reads, its messages out of the
 * MAX_MESSAGES it answers from and the jetons of its context out of COACH_CONTEXT_MAX_TOKENS, as the server last said
 * them. Shared by the web's Activité and the native app's (#690), so both fill and warn alike.
 */

/** Most messages the AI Coach answers from. */
export const MAX_MESSAGES = 40;

/** The ceiling of the AI Coach's context, in estimated tokens: what it is told of the Candidate is fitted under it. */
export const COACH_CONTEXT_MAX_TOKENS = 12_000;

/**
 * What the server says of a Coach Conversation for its Context bar (#607): its `messages`, and `tokens`, the estimate
 * of the context sent with its latest reply: the AI Coach's system text and the messages it read.
 */
export type ConversationContext = { messages: number; tokens: number };

/** From this share of either limit, the Context bar says the AI Coach reads only the latest messages. */
const NEARLY_FULL = 0.8;

/** The Context bar: its figures, the share it is filled to (that of the limit nearer reached, at most 1), and whether it is nearly full. */
export type ContextBar = ConversationContext & { maxMessages: number; maxTokens: number; share: number; nearlyFull: boolean };

/** The Context bar of a conversation, from what the server says of it; empty for one not yet started (null). */
export function contextBar(context: ConversationContext | null): ContextBar {
  const { messages, tokens } = context ?? { messages: 0, tokens: 0 };
  const share = Math.min(1, Math.max(messages / MAX_MESSAGES, tokens / COACH_CONTEXT_MAX_TOKENS));
  return { messages, maxMessages: MAX_MESSAGES, tokens, maxTokens: COACH_CONTEXT_MAX_TOKENS, share, nearlyFull: share >= NEARLY_FULL };
}
