import { meetingTool } from "./meeting";
import { getCoachContacts } from "./contacts-server";
import Link from "next/link";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { CalledBy } from "@/components/CalledBy";
import { Card } from "@/design/Card";
import type { getServerT } from "@/i18n/server";
import { MeetingLink } from "./MeetingLink";
import type { WorkspaceSession } from "./workspace";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
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
    <Card
      as={ARTICLE}
      headingLevel={3}
      title={
        <>
          <Link href={coachSessionUrl(session.id)}>{session.candidateName || t("coachSpace.unnamedCandidate")}</Link>
          <CalledBy name={session.candidateCalledBy} t={t} />
        </>
      }
    >
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
    </Card>
  );
}
