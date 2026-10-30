import type { Metadata } from "next";
import Link from "next/link";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { CoachingSessionDialog } from "@/components/CoachingSessionDialog";
import { CoachSpaceHeader } from "@/components/CoachSpaceHeader";
import type { CoachedSession, SessionEditor } from "@/human-coaches";
import { getHumanCoaches, requireHumanCoach } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

/** Who edits a session from here: the Human Coach, never the Candidate's note. */
const EDITOR: SessionEditor = "coach";

export async function generateMetadata(): Promise<Metadata> {
  await requireHumanCoach();
  const t = await getServerT();
  return { title: `${t("coachSpace.title")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * A Human Coach's home: their own Coaching Sessions, whose date and video link they enter or
 * correct (ADR-0027), and the Candidates who granted them Coach Access.
 */
export default async function CoachSpacePage() {
  const coach = await requireHumanCoach();
  const coaches = getHumanCoaches();
  const [t, locale, candidates, sessions] = await Promise.all([getServerT(), getRequestLocale(), coaches.candidates(coach.id), coaches.coachSessions(coach.id)]);
  const formats = {
    dateTime: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE }),
    date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE }),
  };
  return (
    <main className="page">
      <CoachSpaceHeader />
      <h1>{t("coachSpace.title")}</h1>
      <section className="stack" aria-labelledby="coach-space-sessions-title">
        <h2 id="coach-space-sessions-title">{t("coachSpace.sessionsTitle")}</h2>
        <p>{t("coachSpace.sessionsIntro")}</p>
        {sessions.length === 0 ? (
          <p>{t("coachSpace.sessionsNone")}</p>
        ) : (
          <ul className="coach-sessions">
            {sessions.map((session) => (
              <CoachedSessionItem key={session.id} session={session} formats={formats} t={t} />
            ))}
          </ul>
        )}
      </section>
      <section className="stack" aria-labelledby="coach-space-candidates-title">
        <h2 id="coach-space-candidates-title">{t("coachSpace.candidatesTitle")}</h2>
        <p>{t("coachSpace.intro")}</p>
        {candidates.length === 0 ? (
          <p>{t("coachSpace.none")}</p>
        ) : (
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <Link href={routes.coachSpaceCandidate(candidate.id)}>{candidate.name ? `${candidate.name} (${candidate.email})` : candidate.email}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * One of the coach's Coaching Sessions: the Candidate's first name and last initial, its date in French
 * time or « À planifier », its duration and video link, and the button to enter or correct them.
 */
function CoachedSessionItem({ session, formats, t }: { session: CoachedSession; formats: { dateTime: Intl.DateTimeFormat; date: Intl.DateTimeFormat }; t: T }) {
  const name = session.candidateName || t("coachSpace.unnamedCandidate");
  return (
    <li id={`seance-${session.id}`} className="coach-session">
      <p className="coach-session-name">{name}</p>
      {session.scheduledAt ? (
        <p>
          <time dateTime={session.scheduledAt.toISOString()}>{t("coachSpace.sessionOn", { date: formats.dateTime.format(session.scheduledAt) })}</time>
          {session.durationMinutes ? ` · ${t("coachSpace.sessionDuration", { count: session.durationMinutes })}` : null}
        </p>
      ) : (
        <p>
          <strong>{t("coachSpace.sessionToSchedule")}</strong>
        </p>
      )}
      {session.videoLink ? (
        <p>
          <a href={session.videoLink} rel="noopener noreferrer" target="_blank">
            {t("coachSpace.joinVideo", { name })}
          </a>
        </p>
      ) : null}
      <p className="hint">{t("coachSpace.sessionPaidOn", { date: formats.date.format(session.paidAt) })}</p>
      <div className="actions">
        <CoachingSessionDialog
          editor={EDITOR}
          session={{
            id: session.id,
            scheduledAt: session.scheduledAt ? interviewWallClock(session.scheduledAt) : "",
            durationMinutes: session.durationMinutes,
            videoLink: session.videoLink,
            note: null,
          }}
          withName={name}
        />
      </div>
    </li>
  );
}
