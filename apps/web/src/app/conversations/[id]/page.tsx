import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { FreeConversationPage } from "@/components/FreeConversationPage";
import { conversationFirst } from "@/conversation-first";
import { getServerT } from "@/i18n/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

type Params = { params: Promise<{ id: string }> };

/** The Candidate's Free conversation `id`, or none: another Candidate's, one with a Subject, or the switch off. */
async function freeConversation(id: string) {
  if (!conversationFirst(getPlatformSettingsResolver().current())) return null;
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const conversation = await getCoachConversations().open(candidate.id, id);
  return conversation && conversation.subject === null ? { candidate, conversation } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const found = await freeConversation((await params).id);
  return { title: found ? `${found.conversation.title} · ${t("app.name")}` : t("app.name") };
}

/**
 * A Free conversation of the Candidate's (#601, ADR-0070), under « Conversation au centre »: the conversation is the
 * page, listed under « Coach » in the Sidebar, named by its title in the Top Bar. Not found while the switch is off.
 */
export default async function ConversationPage({ params }: Params) {
  const found = await freeConversation((await params).id);
  if (!found) notFound();
  return (
    <CandidateLayout candidateId={found.candidate.id} title={found.conversation.title}>
      <FreeConversationPage conversationId={found.conversation.id} />
    </CandidateLayout>
  );
}
