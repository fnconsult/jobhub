import type { Metadata } from "next";
import Link from "next/link";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartJobSearchButton } from "@/components/JobSearchControls";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnJobSearch } from "@/job-searches/server";
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
          <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} />
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
