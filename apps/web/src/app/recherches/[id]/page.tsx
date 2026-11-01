import type { Metadata } from "next";
import Link from "next/link";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartJobSearchButton, StopJobSearchButton } from "@/components/JobSearchControls";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { SearchCriteriaDialog } from "@/components/SearchCriteriaDialog";
import { searchCriteriaInWords } from "@/components/job-search-words";
import { getServerT } from "@/i18n/server";
import { requireOwnJobSearch } from "@/job-searches/server";
import { routes } from "@/routes";
import { JobSearchOutcome, STATUS_TONE, loadJobSearchPage, type Params } from "./job-search-page";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobSearch } = await requireOwnJobSearch((await params).id);
  return { title: `${t("jobSearch.title", { profile: jobSearch.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Search, as a document (prototype #132): what was searched, its
 * status, when it started and the Search Criteria its Match Scores are against
 * (a button opening them in a dialog, #237); then, while the AI Coach searches, a notice
 * (the page refreshes itself) and a button to stop it (#331); then the Job Offers found (a stopped or failed
 * search keeps those it had found), best Match Score first, each with its key facts, why it has its score, and a one-click save as
 * an Application with the searched Profile, or why the search failed. The
 * outcome is said in a live region, and replaces the Job Search's notification:
 * opening the page dismisses it. It ends with searching again.
 * Under « Conversation au centre » (#605, ADR-0070), the page is the Job Search's conversation instead (layout.tsx).
 */
export default async function JobSearchPage({ params }: Params) {
  if (pagesAreConversations()) return null;
  const data = await loadJobSearchPage((await params).id);
  const { candidateId, jobSearch, t, locale, industries, aiActivity, inView } = data;
  const { profile, status, results } = jobSearch;
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
        <JobSearchOutcome data={data} />
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
