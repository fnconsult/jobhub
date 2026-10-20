/**
 * The conversation window: the AI Coach answers from the most recent messages
 * of a Coach Conversation, however long it has grown. Coach Conversations read
 * only this window from the database, and the AI Coach trims to it rather than
 * refusing a longer conversation. No server-only imports: the Coach Panel and
 * the worker (which purges Coach Conversations) bundle it.
 */

export interface CoachMessage {
  from: "candidate" | "coach";
  text: string;
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

/** The last MAX_MESSAGES messages, starting with a Candidate message. */
export function recentConversation<T extends CoachMessage>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const start = recent.findIndex((message) => message.from === "candidate");
  return start === -1 ? [] : recent.slice(start);
}
