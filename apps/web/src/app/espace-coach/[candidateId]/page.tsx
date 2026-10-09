import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachSpaceHeader } from "@/components/CoachSpaceHeader";
import { MasterCvView } from "@/components/MasterCvView";
import { getHumanCoaches, requireHumanCoach } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ candidateId: string }> };

/** The Candidate's file, or 404 without Coach Access. */
async function candidateFile(params: Params["params"]) {
  const coach = await requireHumanCoach();
  const file = await getHumanCoaches().candidateFile(coach.id, decodeURIComponent((await params).candidateId));
  if (!file) notFound();
  return file;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { candidate } = await candidateFile(params);
  const t = await getServerT();
  return { title: `${candidate.name || candidate.email} · ${t("coachSpace.title")}`, robots: { index: false } };
}

/** What a Human Coach reads of a Candidate who granted them Coach Access: their Profiles and Applications, read only. */
export default async function CoachedCandidatePage({ params }: Params) {
  const { candidate, profiles, applications } = await candidateFile(params);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });
  return (
    <main className="page">
      <CoachSpaceHeader />
      <p>
        <Link href={routes.coachSpace}>{t("coachSpace.back")}</Link>
      </p>
      <h1>{candidate.name || candidate.email}</h1>
      <p className="notice">{t("coachSpace.readOnly")}</p>

      <section className="stack" aria-labelledby="applications-title">
        <h2 id="applications-title">{t("coachSpace.applicationsTitle")}</h2>
        {applications.length === 0 ? (
          <p>{t("coachSpace.applicationsNone")}</p>
        ) : (
          <ul>
            {applications.map((application) => (
              <li key={application.id}>
                <Link href={routes.coachSpaceApplication(candidate.id, application.id)}>
                  {application.jobOffer.employer ? `${application.jobOffer.title} · ${application.jobOffer.employer}` : application.jobOffer.title}
                </Link>{" "}
                {t("coachSpace.applicationStatus", { status: t(`applicationStatuses.${application.status}`), date: date.format(application.statusChangedAt) })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" aria-labelledby="profiles-title">
        <h2 id="profiles-title">{t("coachSpace.profilesTitle")}</h2>
        {profiles.map((profile) => (
          <article key={profile.id} className="stack" aria-labelledby={`profile-${profile.id}`}>
            <h3 id={`profile-${profile.id}`}>
              {profile.archived ? `${profile.name} ${t("coachSpace.archived")}` : profile.name}
            </h3>
            {profile.searchCriteria.targetRole ? <p>{t("coachSpace.targetRole", { role: profile.searchCriteria.targetRole })}</p> : null}
            <MasterCvView cv={profile.masterCv.content} t={t} />
          </article>
        ))}
      </section>
    </main>
  );
}
