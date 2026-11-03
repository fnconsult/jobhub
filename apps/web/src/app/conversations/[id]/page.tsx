import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { FreeConversationPage } from "@/components/FreeConversationPage";
import { getServerT } from "@/i18n/server";

type Params = { params: Promise<{ id: string }> };

/** The Candidate's Free conversation `id`, or none: another Candidate's, or one with a Subject. */
async function freeConversation(id: string) {
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
 * A Free conversation of the Candidate's (#601, ADR-0070): the conversation is the page, listed under « Coach » in the
 * Sidebar, named by its title in the Top Bar.
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
