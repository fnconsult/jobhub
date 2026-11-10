import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachConversationPage } from "@/components/CoachConversationPage";
import { getServerT } from "@/i18n/server";
const KIND = "coaching_session";
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const person = await getCurrentCandidate();
  if (!person) return signInRedirect();
  if (!coachSpaceV2On()) notFound();
  const { sessionId } = await params;
  const session = (await getHumanCoaches().sessions(person.id)).find((session) => session.id === sessionId);
  if (!session) notFound();
  const subject = { kind: KIND, id: session.id } as const;
  const found = await getCoachConversations().ofSubject(person.id, subject);
  if (!found.ok) notFound();
  const t = await getServerT();
  return (
    <CandidateLayout candidateId={person.id} title={t("coachReports.title")}>
      <CoachConversationPage conversationId={found.conversation?.id ?? null} subject={subject} introduction={<p>{t("coachReports.immutable")}</p>} />
    </CandidateLayout>
  );
}
