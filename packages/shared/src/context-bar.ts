/**
 * The Context bar (#607, ADR-0070, ADR-0078): how much of a Coach Conversation the AI Coach reads, its messages out of the
 * Coach context limits of the Candidate's Plan and the jetons of its context out of the same limits, as the server last
 * said them (a Plan with none stored: DEFAULT_COACH_CONTEXT_LIMITS). Shared by the web's Activité and the native app's
 * (#690), so both fill and warn alike.
 */
import { DEFAULT_COACH_CONTEXT_LIMITS, type CoachContextLimits } from "./domain";

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
