import type { Metadata } from "next";
import Link from "next/link";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartJobSearchButton } from "@/components/JobSearchControls";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobSearches, requireOwnJobSearch } from "@/job-searches/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobSearch } = await requireOwnJobSearch((await params).id);
  return { title: `${t("jobSearch.title", { profile: jobSearch.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Search: while the AI Coach searches, a notice (the page refreshes
 * itself); then the Job Offers found, best Match Score first, each with its key
 * facts and a one-click save as an Application with the searched Profile, or
 * why it failed. The outcome is said in a live region, and replaces the Job
 * Search's notification: opening the page dismisses it.
 */
export default async function JobSearchPage({ params }: Params) {
  const { candidateId, jobSearch } = await requireOwnJobSearch((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const { profile, status, results } = jobSearch;
  // This page shows how the Job Search ended: no need to notify the Candidate of it any more.
  if (status !== "searching") await getJobSearches().dismissNotification(candidateId, jobSearch.id);
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const startedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(jobSearch.startedAt);
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id}>
      <p>
        <Link href={routes.profile(profile.id)}>{t("jobSearch.backToProfile")}</Link>
      </p>
      <h1>{t("jobSearch.title", { profile: profile.name })}</h1>
      <p>{t("jobSearch.startedAt", { date: startedAt })}</p>
      <CoachInView {...inView} />

      <div className="stack" role="status">
        {status === "searching" ? <p className="notice">{t("jobSearch.searching")}</p> : null}
        {status === "failed" ? (
          <div className="notice">
            <p>{t("jobSearch.failed")}</p>
            <p>{`${t(`jobSearch.failureReasons.${jobSearch.failure ?? "other"}`)} ${t("jobSearch.notCounted")}`}</p>
          </div>
        ) : null}
        {status === "done" && results.length === 0 ? <p className="notice">{t("jobSearch.noResults")}</p> : null}
        {results.length > 0 ? <p>{t("jobSearch.resultsIntro", { count: results.length })}</p> : null}
      </div>
      {status === "searching" ? <RefreshWhileSearching /> : null}

      {results.length > 0 ? <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} /> : null}

      {status !== "searching" ? (
        <section className="stack" aria-label={t("jobSearch.sectionTitle")}>
          <StartJobSearchButton profileId={profile.id} label={t("jobSearch.searchAgain")} className="button" />
        </section>
      ) : null}
    </CandidateLayout>
  );
}
