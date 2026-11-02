import type { CoachMessage, ConversationContext, JobOfferCard } from "@/coach/conversation";
import type { ConversationSummary } from "@/components/CoachConversationList";
import type { Provenance } from "@jobhub/shared";

/**
 * What the Candidate's Coach Conversations and the Back Office Assistant's conversations share in the browser (#608): a
 * saved message as their servers give it back, and reading a saved conversation. The pages that show them are apart:
 * the Candidate's conversation is the page (CoachConversationPage), the Administrator's is a side panel
 * (BackOfficeAssistantPanel).
 */

/** A message as either server gives it back: the person's own (`candidate`, `administrator`), or the AI's reply. */
export type ServerMessage = {
  from: "candidate" | "coach" | "administrator" | "assistant";
  text: string;
  blocked?: true;
  jobOffer?: JobOfferCard;
  /** On a reply: what served it (#327), null when nothing was kept, and when it was saved. */
  provenance?: Provenance | null;
  at?: string;
};

/** A message as it is shown: the person's own, or the AI's reply. */
export const asShownMessage = (message: ServerMessage): CoachMessage => ({
  from: message.from === "candidate" || message.from === "administrator" ? "candidate" : "coach",
  text: message.text,
  ...(message.blocked ? { blocked: true as const } : {}),
  ...(message.jobOffer ? { jobOffer: message.jobOffer } : {}),
  ...(message.at ? { provenance: message.provenance ?? null, at: message.at } : {}),
});

/** A saved conversation with its messages, as shown. */
export type SavedConversation = ConversationSummary & { aiDisclosure: boolean; messages: CoachMessage[]; context: ConversationContext | null };

/** The saved conversation `conversationId` at `endpoint`, or why not: `gone` when it no longer exists, else it could not be read. */
export async function fetchConversation(endpoint: string, conversationId: string): Promise<{ conversation: SavedConversation } | { gone: boolean }> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(conversationId)}`).catch(() => null);
  if (!response?.ok) return { gone: response?.status === 404 };
  const { conversation } = (await response.json()) as { conversation: ConversationSummary & { aiDisclosure?: boolean; messages: ServerMessage[]; context?: ConversationContext } };
  return {
    conversation: { ...conversation, aiDisclosure: conversation.aiDisclosure === true, messages: conversation.messages.map(asShownMessage), context: conversation.context ?? null },
  };
}
