import { MeetingForm } from "@/coach-space/MeetingForm";
import { getCoachContacts } from "@/coach-space/contacts-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { interviewWallClock } from "@/applications";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { CoachingSessionDialog } from "@/components/CoachingSessionDialog";
import { PrivateNotes } from "@/coach-space/PrivateNotes";
import { SessionCard, coachCandidateUrl } from "@/coach-space/SessionCard";
import { requireCoachSpaceV2 } from "@/coach-space/server";
import { sessionPhase } from "@/coach-space/workspace";
import { getCoachWorkspace } from "@/coach-space/workspace-server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
const EDITOR = "coach";
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const coach = await requireCoachSpaceV2();
  const space = getCoachWorkspace();
  const session = await space.session(coach.id, (await params).sessionId);
  if (!session) notFound();
  const [t, locale, timeZone, note] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getCoachingTimeZones().coach(coach.id),
    space.note(coach.id, session.candidateId, session.id),
  ]);
  if (!note) notFound();
  const phase = sessionPhase(session, new Date());
  return (
    <CoachSpaceShell>
      <section className="coach-space-card">
        <h2>{t(`coachWorkspace.phase.${phase}`)}</h2>
        <p>{t("coachWorkspace.soldByJobbbox")}</p>
        <Link href={coachCandidateUrl(session.candidateId)}>{t("coachWorkspace.prepare")}</Link>
        {session.scheduledAt ? <p>{coachingTime(session.scheduledAt, locale, timeZone)}</p> : null}
        <CoachingSessionDialog
          editor={EDITOR}
          session={{
            id: session.id,
            scheduledAt: session.scheduledAt ? interviewWallClock(session.scheduledAt) : "",
            durationMinutes: session.durationMinutes,
            videoLink: session.videoLink,
            note: null,
          }}
          withName={session.candidateName}
        />
      </section>
      <SessionCard coachId={coach.id} session={session} t={t} locale={locale} timeZone={timeZone} />
      <section className="coach-space-card">
        <h2>{t("coachMeeting.sessionContact")}</h2>
        <MeetingForm sessionId={session.id} initial={await getCoachContacts().ofSession(coach.id, session.id)} />
      </section>
      <section className="coach-space-card">
        <PrivateNotes candidateId={session.candidateId} sessionId={session.id} initial={note} />
      </section>
    </CoachSpaceShell>
  );
}
