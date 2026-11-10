import { meetingTool } from "./meeting";
import { getCoachContacts } from "./contacts-server";
import Link from "next/link";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { CalledBy } from "@/components/CalledBy";
import type { getServerT } from "@/i18n/server";
import { MeetingLink } from "./MeetingLink";
import type { WorkspaceSession } from "./workspace";
export const coachSessionUrl = (id: string) => `/espace-coach/seances/${encodeURIComponent(id)}`;
export const coachCandidateUrl = (id: string) => `/espace-coach/candidates/${encodeURIComponent(id)}`;
export async function SessionCard({
  session,
  locale,
  timeZone,
  t,
  coachId,
}: {
  coachId: string;
  session: WorkspaceSession;
  locale: string;
  timeZone: string;
  t: Awaited<ReturnType<typeof getServerT>>;
}) {
  const meeting = await getCoachContacts().ofSession(coachId, session.id);
  return (
    <article className="coach-space-card">
      <h3>
        <Link href={coachSessionUrl(session.id)}>{session.candidateName || t("coachSpace.unnamedCandidate")}</Link>
        <CalledBy name={session.candidateCalledBy} t={t} />
      </h3>
      <p>{session.scheduledAt ? coachingTime(session.scheduledAt, locale, timeZone) : t("coachSpace.sessionToSchedule")}</p>
      {session.durationMinutes ? <p>{t("coachSpace.sessionDuration", { count: session.durationMinutes })}</p> : null}
      {meeting ? <p>{meeting.kind === "phone" ? t("coachMeeting.phone") : t(`coachMeeting.tools.${meetingTool(meeting.target)}`)}</p> : null}
      <MeetingLink
        coach
        meeting={meeting}
        scheduledAt={session.scheduledAt?.toISOString() ?? null}
        durationMinutes={session.durationMinutes}
        timeZone={timeZone}
      />
    </article>
  );
}
