import { getSessionReports } from "@/coach-space/reports-server";
import Link from "next/link";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { CalledBy } from "@/components/CalledBy";
import { requireCoachSpace } from "@/coach-space/server";
import { getCoachWorkspace } from "@/coach-space/workspace-server";
import { SessionCard, coachSessionUrl, coachCandidateUrl } from "@/coach-space/SessionCard";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
export default async function Page() {
  const coach = await requireCoachSpace();
  const [t, locale, timeZone] = await Promise.all([getServerT(), getRequestLocale(), getCoachingTimeZones().coach(coach.id)]);
  const day = await getCoachWorkspace().today(coach.id, new Date(), timeZone);
  const reportsDue = await getSessionReports().due(coach.id);
  const props = { t, locale, timeZone };
  return (
    <CoachSpaceShell>
      <section className="stack">
        <h2>{t("coachWorkspace.today")}</h2>
        {day.today.length ? (
          day.today.map((session) => <SessionCard coachId={coach.id} key={session.id} session={session} {...props} />)
        ) : (
          <p>{t("coachSpaceV2.empty.aujourdhui")}</p>
        )}
      </section>
      <section className="stack">
        <h2>{t("coachWorkspace.tomorrow")}</h2>
        {day.tomorrow.length ? (
          day.tomorrow.map((session) => <SessionCard coachId={coach.id} key={session.id} session={session} {...props} />)
        ) : (
          <p>{t("coachWorkspace.noTomorrow")}</p>
        )}
      </section>
      <section className="coach-space-card">
        <h2>{t("coachWorkspace.todo")}</h2>
        {day.toSchedule.length + day.toConfirm.length + reportsDue.length === 0 ? (
          <p>{t("coachWorkspace.nothingTodo")}</p>
        ) : (
          <ul>
            {day.toSchedule.map((session) => (
              <li key={session.id}>
                <Link href={coachSessionUrl(session.id)}>{t("coachWorkspace.schedule", { name: session.candidateName })}</Link>
              </li>
            ))}
            {day.toConfirm.map((session) => (
              <li key={session.id}>
                <Link href={coachSessionUrl(session.id)}>{t("coachWorkspace.confirm", { name: session.candidateName })}</Link>
              </li>
            ))}
            {reportsDue.map((id) => (
              <li key={id}>
                <Link href={coachSessionUrl(id)}>{t("coachReports.write")}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="coach-space-card">
        <h2>{t("coachWorkspace.recent")}</h2>
        {day.recent.length ? (
          <ul>
            {day.recent.map((candidate) => (
              <li key={candidate.id}>
                <Link href={coachCandidateUrl(candidate.id)}>{candidate.name || t("coachSpace.unnamedCandidate")}</Link>
                <CalledBy name={candidate.calledBy} t={t} />
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("coachSpaceV2.empty.candidates")}</p>
        )}
      </section>
    </CoachSpaceShell>
  );
}
