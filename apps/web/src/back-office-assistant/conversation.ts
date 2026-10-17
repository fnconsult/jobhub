/**
 * The Back Office Assistant's conversation window: it answers from the most recent
 * messages, however long a conversation has grown. No server-only imports: the
 * panel and the worker (which purges the conversations) bundle it.
 */

/** One message of a conversation with the Back Office Assistant. */
export interface AssistantMessage {
  from: "administrator" | "assistant";
  text: string;
}

/** Longest single message, and most messages the assistant answers from. */
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_MESSAGES = 40;

/** The last MAX_MESSAGES messages, starting with an Administrator's message. */
export function recentMessages<T extends AssistantMessage>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_MESSAGES);
  const start = recent.findIndex((message) => message.from === "administrator");
  return start === -1 ? [] : recent.slice(start);
}
