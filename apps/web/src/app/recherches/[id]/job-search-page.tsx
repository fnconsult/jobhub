import { cache } from "react";
import { loadAiActivity } from "@/ai-activity/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobSearches, requireOwnJobSearch } from "@/job-searches/server";
import { readIndustryReference } from "@/reference-data/server";

export type Params = { params: Promise<{ id: string }> };
type T = Awaited<ReturnType<typeof getServerT>>;

/** The Job Search's status as a pill: in words, the colour only reinforces it. */
export const STATUS_TONE = { searching: undefined, done: "success", failed: "danger", stopped: undefined } as const;

/**
 * Everything a Job Search's page shows, loaded once per request (its layout, its page and what opens in the Work Pane
 * share it). Sends anonymous visitors to sign in, and answers 404 for a Job Search that is not theirs. Opening the page
 * of a Job Search that has ended dismisses its notification: the page shows how it ended.
 */
export const loadJobSearchPage = cache(async (id: string) => {
  const { candidateId, jobSearch } = await requireOwnJobSearch(id);
  const [t, locale, industries, aiActivity] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    readIndustryReference(),
    loadAiActivity.jobSearches([jobSearch], { candidateId, jobSearchId: jobSearch.id }),
  ]);
  if (jobSearch.status !== "searching") await getJobSearches().dismissNotification(candidateId, jobSearch.id);
  const inView = { kind: "job_search", id: jobSearch.id, name: jobSearch.profile.name, profileId: jobSearch.profile.id } as const;
  return { candidateId, jobSearch, t, locale, industries, aiActivity, inView };
});

export type JobSearchPageData = Awaited<ReturnType<typeof loadJobSearchPage>>;

/**
 * How the Job Search stands, in a live region: still searching (the page refreshes itself), failed and why (and the Job
 * Offers it kept), stopped, or done without a Job Offer; then how many it found.
 */
export function JobSearchOutcome({ data: { jobSearch, t } }: { data: { jobSearch: JobSearchPageData["jobSearch"]; t: T } }) {
  const { status, results } = jobSearch;
  return (
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
  );
}
