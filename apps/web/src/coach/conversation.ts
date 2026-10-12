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
