/**
 * The AI Coach replies the page's thread shows, as its Activité entries take them (ADR-0086, #808): the page's
 * Activity lists the replies of its Coach Conversation, with their questions and cards, and links each back to its
 * message (« Voir dans la conversation »).
 *
 *   threadReplies(messages)   each saved reply, known by when it was saved (its `messageId`)
 *   messageAnchor(messageId)  where the thread shows it (`data-message-id`)
 *
 * Pure, and safe in the browser: no server-only import.
 */
import type { CoachMessage } from "../coach/conversation";
import type { CardGiven, ReplyGiven } from "./entries";

/** A message of the thread: a saved one, or a reply the Candidate stopped (no message of its own). */
type ThreadMessage = Pick<CoachMessage, "from" | "text" | "provenance" | "at" | "sent" | "seenNames" | "cards"> | { from: "stopped" };

/** The thread's saved AI Coach replies, oldest first, each with the Candidate's message just before it as its question. */
export function threadReplies(messages: readonly ThreadMessage[]): ReplyGiven[] {
  let question: string | null = null;
  const replies: ReplyGiven[] = [];
  for (const message of messages) {
    if (message.from === "candidate") {
      question = message.text;
      continue;
    }
    if (message.from !== "coach") continue;
    if (message.at) {
      replies.push({
        messageId: message.at,
        at: message.at,
        question,
        provenance: message.provenance ?? null,
        sent: message.sent ?? null,
        ...(message.seenNames ? { seenNames: message.seenNames } : {}),
        cards: (message.cards ?? []).map(
          (card): CardGiven => ({
            id: card.id,
            status: card.status,
            ...(card.decidedAt ? { decidedAt: card.decidedAt } : {}),
            change: { target: { href: card.change.target.href, name: card.change.target.name }, what: card.change.what, before: card.change.before, after: card.change.after },
          }),
        ),
      });
    }
    question = null;
  }
  return replies;
}

/** The selector of a reply's message in the thread. */
export const messageAnchor = (messageId: string) => `[data-message-id="${messageId.replace(/["\\]/g, "")}"]`;
