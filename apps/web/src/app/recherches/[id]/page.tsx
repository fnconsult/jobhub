import type { Metadata } from "next";
import Link from "next/link";
import { CoachInView } from "@/components/CoachPanel";
import { RefreshWhileSearching, SaveSearchResultButton, StartJobSearchButton } from "@/components/JobSearchControls";
import { jobOfferSalary, jobOfferSite } from "@/components/JobOfferView";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import type { JobSearchResult } from "@/job-searches";
import { requireOwnJobSearch } from "@/job-searches/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };
type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobSearch } = await requireOwnJobSearch((await params).id);
  return { title: `${t("jobSearch.title", { profile: jobSearch.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Search: while the AI Coach searches, a notice (the page refreshes
 * itself); then the Job Offers found, best Match Score first, each with its key
 * facts and a one-click save as an Application with the searched Profile.
 */
export default async function JobSearchPage({ params }: Params) {
  const { candidateId, jobSearch } = await requireOwnJobSearch((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const { profile, status, results } = jobSearch;
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const startedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(jobSearch.startedAt);
  return (
    <main className="page">
      <WorkspaceHeader candidateId={candidateId} currentProfileId={profile.id} />
      <p>
        <Link href={routes.profile(profile.id)}>{t("jobSearch.backToProfile")}</Link>
      </p>
      <h1>{t("jobSearch.title", { profile: profile.name })}</h1>
      <p>{t("jobSearch.startedAt", { date: startedAt })}</p>
      <CoachInView {...inView} />

      {status === "searching" ? (
        <>
          <p className="notice" role="status">
            {t("jobSearch.searching")}
          </p>
          <RefreshWhileSearching />
        </>
      ) : null}
      {status === "failed" ? (
        <p className="notice" role="alert">
          {t("jobSearch.failed")}
        </p>
      ) : null}
      {status === "done" && results.length === 0 ? <p className="notice">{t("jobSearch.noResults")}</p> : null}

      {results.length > 0 ? (
        <>
          <p>{t("jobSearch.resultsIntro", { count: results.length })}</p>
          <ol className="search-results">
            {results.map((result) => (
              <SearchResult key={result.jobOffer.id} result={result} profileId={profile.id} t={t} locale={locale} />
            ))}
          </ol>
        </>
      ) : null}

      {status !== "searching" ? (
        <section className="stack" aria-label={t("jobSearch.sectionTitle")}>
          <StartJobSearchButton profileId={profile.id} label={t("jobSearch.searchAgain")} className="button" />
        </section>
      ) : null}
    </main>
  );
}

function SearchResult({ result, profileId, t, locale }: { result: JobSearchResult; profileId: string; t: T; locale: string }) {
  const { jobOffer, matchScore, applicationId } = result;
  const salary = jobOfferSalary(jobOffer, t, locale);
  const site = jobOfferSite(jobOffer);
  const titleId = `search-result-${jobOffer.id}`;
  return (
    <li className="search-result">
      <h2 id={titleId}>{jobOffer.title}</h2>
      <p className="match-score-value">{t("jobSearch.matchScore", { score: matchScore.score })}</p>
      <dl className="job-offer-details">
        {jobOffer.employer ? <Fact term={t("jobOffer.employer")}>{jobOffer.employer}</Fact> : null}
        {jobOffer.location ? <Fact term={t("jobOffer.location")}>{jobOffer.location}</Fact> : null}
        {jobOffer.contractType ? <Fact term={t("jobOffer.contractType")}>{t(`cvReview.contractTypes.${jobOffer.contractType}`)}</Fact> : null}
        {jobOffer.remoteWork ? <Fact term={t("jobOffer.remoteWork")}>{t(`cvReview.remoteWorkOptions.${jobOffer.remoteWork}`)}</Fact> : null}
        {salary ? <Fact term={t("jobOffer.salary")}>{salary}</Fact> : null}
        {site ? <Fact term={t("jobOffer.source")}>{site}</Fact> : null}
      </dl>
      <div className="actions">
        {applicationId ? (
          <>
            <p>{t("jobSearch.saved")}</p>
            <Link className="button button-primary" href={routes.application(applicationId)} aria-describedby={titleId}>
              {t("jobSearch.seeApplication")}
            </Link>
          </>
        ) : (
          <SaveSearchResultButton jobOfferId={jobOffer.id} profileId={profileId} describedBy={titleId} />
        )}
        <Link className="button" href={routes.jobOffer(jobOffer.id)} aria-describedby={titleId}>
          {t("jobSearch.seeJobOffer")}
        </Link>
      </div>
    </li>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
