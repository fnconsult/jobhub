import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { CalledBy } from "@/components/CalledBy";
import { MasterCvView } from "@/components/MasterCvView";
import { PrivateNotes } from "@/coach-space/PrivateNotes";
import { requireCoachSpace } from "@/coach-space/server";
import { getCoachWorkspace } from "@/coach-space/workspace-server";
import { SessionCard } from "@/coach-space/SessionCard";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
export default async function Page({ params }: { params: Promise<{ candidateId: string }> }) {
  const coach = await requireCoachSpace();
  const file = await getCoachWorkspace().candidate(coach.id, (await params).candidateId);
  if (!file) notFound();
  const [t, locale, timeZone] = await Promise.all([getServerT(), getRequestLocale(), getCoachingTimeZones().coach(coach.id)]);
  return (
    <CoachSpaceShell>
      <section className="coach-space-card">
        <h2>
          {file.person.name || t("coachSpace.unnamedCandidate")}
          <CalledBy name={file.person.calledBy} t={t} />
        </h2>
        <p>{t(file.person.access ? "coachWorkspace.access" : "coachWorkspace.noAccess")}</p>
        <PrivateNotes candidateId={file.person.id} initial={file.note} />
      </section>
      <section className="stack">
        <h2>{t("coachSpaceV2.pages.seances")}</h2>
        {file.sessions.map((session) => (
          <SessionCard coachId={coach.id} key={session.id} session={session} t={t} locale={locale} timeZone={timeZone} />
        ))}
      </section>
      {file.file ? (
        <>
          <section className="coach-space-card">
            <h2>{t("coachSpace.applicationsTitle")}</h2>
            <p>{t("coachSpace.readOnly")}</p>
            <ul>
              {file.file.applications.map((application) => (
                <li key={application.id}>
                  <Link href={routes.coachSpaceApplication(file.person.id, application.id)}>{application.jobOffer.title}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="coach-space-card">
            <h2>{t("coachSpace.profilesTitle")}</h2>
            {file.file.profiles.map((profile) => (
              <article key={profile.id}>
                <h3>{profile.name}</h3>
                <MasterCvView cv={profile.masterCv.content} t={t} />
              </article>
            ))}
          </section>
        </>
      ) : null}
    </CoachSpaceShell>
  );
}
