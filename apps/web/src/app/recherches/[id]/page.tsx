import type { Metadata } from "next";
import Link from "next/link";
import { loadAiActivity } from "@/ai-activity/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartJobSearchButton, StopJobSearchButton } from "@/components/JobSearchControls";
import { SearchCriteriaDialog } from "@/components/SearchCriteriaDialog";
import { searchCriteriaInWords } from "@/components/job-search-words";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobSearches, requireOwnJobSearch } from "@/job-searches/server";
import { readIndustryReference } from "@/reference-data/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobSearch } = await requireOwnJobSearch((await params).id);
  return { title: `${t("jobSearch.title", { profile: jobSearch.profile.name })} · ${t("app.name")}` };
}

/** The Job Search's status as a pill: in words, the colour only reinforces it. */
const STATUS_TONE = { searching: undefined, done: "success", failed: "danger", stopped: undefined } as const;

/**
 * One Job Search, as a document (prototype #132): what was searched, its
 * status, when it started and the Search Criteria its Match Scores are against
 * (a button opening them in a dialog, #237); then, while the AI Coach searches, a notice
 * (the page refreshes itself) and a button to stop it (#331); then the Job Offers found (a stopped or failed
 * search keeps those it had found), best Match Score first, each with its key facts, why it has its score, and a one-click save as
 * an Application with the searched Profile, or why the search failed. The
 * outcome is said in a live region, and replaces the Job Search's notification:
 * opening the page dismisses it. It ends with searching again.
 */
export default async function JobSearchPage({ params }: Params) {
  const { candidateId, jobSearch } = await requireOwnJobSearch((await params).id);
  const [t, locale, industries, aiActivity] = await Promise.all([getServerT(), getRequestLocale(), readIndustryReference(), loadAiActivity.jobSearches([jobSearch], { candidateId, jobSearchId: jobSearch.id })]);
  const { profile, status, results } = jobSearch;
  // This page shows how the Job Search ended: no need to notify the Candidate of it any more.
  if (status !== "searching") await getJobSearches().dismissNotification(candidateId, jobSearch.id);
  const inView = { kind: "job_search", id: jobSearch.id, name: profile.name, profileId: profile.id } as const;
  const startedAt = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" }).format(jobSearch.startedAt);
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id} title={t("jobSearch.title", { profile: profile.name })} aiActivity={aiActivity}>
      <header className="page-head">
        <p className="eyebrow">{t("jobSearch.sectionTitle")}</p>
        <dl className="props">
          <dt>{t("jobSearch.status")}</dt>
          <dd>
            <span className="pill" data-tone={STATUS_TONE[status]}>
              {t(`jobSearch.statuses.${status}`)}
            </span>
          </dd>
          <dt>{t("jobSearch.startedOn")}</dt>
          <dd>{startedAt}</dd>
          <dt>{t("jobSearch.criteria")}</dt>
          <dd>
            <span>{searchCriteriaInWords(profile.searchCriteria, t, locale, industries)}</span>
            <SearchCriteriaDialog profileId={profile.id} profileName={profile.name} searchCriteria={profile.searchCriteria} />
          </dd>
        </dl>
        <div className="page-head-status" role="status">
          {status === "searching" ? <p className="notice">{t("jobSearch.searching")}</p> : null}
          {status === "failed" ? (
            <div className="notice notice-failed">
              <p>{t("jobSearch.failed")}</p>
              <p>{`${t(`jobSearch.failureReasons.${jobSearch.failure ?? "other"}`)}${results.length > 0 ? ` ${t("jobSearch.keptBeforeFailure", { count: results.length })}` : ""} ${t("jobSearch.notCounted")}`}</p>
            </div>
          ) : null}
          {status === "stopped" ? <p className="notice">{t("jobSearch.stopped", { count: results.length })}</p> : null}
          {status === "done" && results.length === 0 ? <p className="notice">{t("jobSearch.noResults")}</p> : null}
          {results.length > 0 ? <p className="lead">{t("jobSearch.resultsIntro", { count: results.length })}</p> : null}
        </div>
      </header>
      <CoachInView {...inView} />
      {status === "searching" ? <RefreshWhileSearching /> : null}

      {results.length > 0 ? <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} /> : null}

      <div className="btn-row">
        {status === "searching" ? <StopJobSearchButton jobSearchId={jobSearch.id} /> : null}
        {status !== "searching" ? (
          <StartJobSearchButton profileId={profile.id} label={t("jobSearch.searchAgain")} variant="secondary" icon={<Icons.searchAgain />} />
        ) : null}
        <Link className="button button-quiet" href={routes.profile(profile.id)}>
          {t("jobSearch.backToProfile")}
        </Link>
      </div>
    </CandidateLayout>
  );
}
