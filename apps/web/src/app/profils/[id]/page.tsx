import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

async function currentProfile(id: string) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const profile = await getProfiles().get(candidate.id, id);
  if (!profile) notFound();
  return profile;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const profile = await currentProfile((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/** One Profile: its Search Criteria and the current version of its Master CV. */
export default async function ProfilePage({ params }: Params) {
  const profile = await currentProfile((await params).id);
  const t = await getServerT();
  const locale = await getRequestLocale();
  const { searchCriteria: criteria, masterCv } = profile;
  const cv = masterCv.content;
  const notSpecified = t("profile.notSpecified");
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{profile.name}</h1>

      <h2>{t("cvReview.searchCriteria")}</h2>
      <dl>
        <dt>{t("cvReview.targetRole")}</dt>
        <dd>{criteria.targetRole}</dd>
        <dt>{t("cvReview.location")}</dt>
        <dd>{criteria.location}</dd>
        <dt>{t("cvReview.minSalary")}</dt>
        <dd>
          {criteria.minSalary === undefined
            ? notSpecified
            : t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) })}
        </dd>
        <dt>{t("cvReview.contractType")}</dt>
        <dd>{criteria.contractType ? t(`cvReview.contractTypes.${criteria.contractType}`) : notSpecified}</dd>
        <dt>{t("cvReview.remoteWork")}</dt>
        <dd>{criteria.remoteWork ? t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) : notSpecified}</dd>
      </dl>

      <h2>{t("profile.masterCv")}</h2>
      <p>{t("profile.version", { version: masterCv.version })}</p>
      <section className="cv">
        {cv.fullName ? <p className="cv-name">{cv.fullName}</p> : null}
        {cv.headline ? <p>{cv.headline}</p> : null}
        {[cv.email, cv.phone, cv.location].some(Boolean) ? <p>{[cv.email, cv.phone, cv.location].filter(Boolean).join(" · ")}</p> : null}
        {cv.summary ? <p className="cv-text">{cv.summary}</p> : null}

        {cv.experience.length > 0 ? (
          <>
            <h3>{t("cvReview.experience")}</h3>
            <ul className="cv-list">
              {cv.experience.map((job, index) => (
                <li key={index}>
                  <p className="cv-entry">{[job.title, job.employer, job.location, job.period].filter(Boolean).join(" · ")}</p>
                  {job.description ? <p className="cv-text">{job.description}</p> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {cv.education.length > 0 ? (
          <>
            <h3>{t("cvReview.education")}</h3>
            <ul className="cv-list">
              {cv.education.map((item, index) => (
                <li key={index}>{[item.degree, item.institution, item.year].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          </>
        ) : null}

        {cv.skills.length > 0 ? (
          <>
            <h3>{t("cvReview.skills")}</h3>
            <ul className="cv-list">
              {cv.skills.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
          </>
        ) : null}

        {cv.languages.length > 0 ? (
          <>
            <h3>{t("cvReview.languages")}</h3>
            <ul className="cv-list">
              {cv.languages.map((language, index) => (
                <li key={index}>{[language.name, language.level].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <p>
        <Link href={routes.account}>{t("profile.backToAccount")}</Link>
      </p>
    </main>
  );
}
