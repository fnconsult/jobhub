// « Espace coach v2 » (ADR-0107): this page is a 404 while it is off.
import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { MeetingLink } from "@/coach-space/MeetingLink";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { Card } from "@/design/Card";
import { getRequestLocale } from "@/i18n/server";
import { SessionBoundaryRefresh } from "@/coach-space/SessionBoundaryRefresh";
import { SharedReadingPanel } from "@/shared-reading/SharedReadingPanel";
import { getSharedReading } from "@/shared-reading/server";
import { notFound } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachConversationPage } from "@/components/CoachConversationPage";
import { getServerT } from "@/i18n/server";
const CANDIDATE = "candidate";
const KIND = "coaching_session";
export default async function Page({ params }: {
    params: Promise<{
        sessionId: string;
    }>;
}) {
    requireCoachSpaceV2();
    const person = await getCurrentCandidate();
    if (!person)
        return signInRedirect();
    const { sessionId } = await params;
    const session = (await getHumanCoaches().sessions(person.id)).find((session) => session.id === sessionId);
    if (!session)
        notFound();
    const subject = { kind: KIND, id: session.id } as const;
    const found = await getCoachConversations().ofSubject(person.id, subject);
    if (!found.ok)
        notFound();
    const canRead = await getSharedReading().canUse({ candidateId: person.id }, session.id);
    const t = await getServerT();
    const locale = await getRequestLocale(), timeZone = await getCoachingTimeZones().candidate(person.id) ?? "Europe/Paris", meeting = (await getCoachContacts().forCandidate(person.id))[session.id] ?? null;
    return (<CandidateLayout candidateId={person.id} title={t("coachReports.title")}>
      <SessionBoundaryRefresh scheduledAt={session.scheduledAt?.toISOString() ?? null} durationMinutes={session.durationMinutes}/>
      <Card title={session.coach.name}>{session.scheduledAt ? <p>{coachingTime(session.scheduledAt, locale, timeZone)}</p> : null}<MeetingLink meeting={meeting} scheduledAt={session.scheduledAt?.toISOString() ?? null} durationMinutes={session.durationMinutes} timeZone={timeZone}/></Card>
      {canRead ? <SharedReadingPanel sessionId={session.id} audience={CANDIDATE}/> : null}
      <CoachConversationPage conversationId={found.conversation?.id ?? null} subject={subject} introduction={<p>{t("coachReports.immutable")}</p>}/>
    </CandidateLayout>);
}
