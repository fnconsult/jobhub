import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import { RefreshWhileSearching, StartJobSearchButton, StopJobSearchButton } from "@/components/JobSearchControls";
import { ObjectConversation } from "@/components/ObjectConversation";
import { SearchCriteriaDialog } from "@/components/SearchCriteriaDialog";
import { searchCriteriaInWords } from "@/components/job-search-words";
import { jobSearchFicheLinks } from "@/fiches";
import { JobSearchOutcome, STATUS_TONE, type JobSearchPageData } from "./job-search-page";

const SUGGESTIONS = ["bestOffers", "widenCriteria", "searchAgain"] as const;
/** The Subject of a Job Search's conversation (ADR-0070). */
const JOB_SEARCH = "job_search";
const TIME_ZONE = "Europe/Paris";

/**
 * A Job Search's page under « Conversation au centre » (#605, ADR-0070): its Coach Conversation, whose Subject it is,
 * with its Introduction and suggestions until its first message; and the Fiche beside it: the Job Search's card (its
 * status, when it started, the Search Criteria its Match Scores are against, how it stands, and « Arrêter la recherche »
 * or « Relancer une recherche »), the list of its Job Offers as its Section, and each Job Offer, with its Match Score, as
 * a Result, opened in the Work Pane at its own address (`children`). While it searches, the page refreshes itself.
 */
export function JobSearchConversation({ data, children }: { data: JobSearchPageData; children: ReactNode }) {
  const { candidateId, jobSearch, t, locale, aiActivity, inView } = data;
  const { profile } = jobSearch;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: TIME_ZONE }).format(jobSearch.startedAt);
  return (
    <ObjectConversation
      candidateId={candidateId}
      subject={{ kind: JOB_SEARCH, id: jobSearch.id }}
      inView={inView}
      title={t("jobSearch.title", { profile: profile.name })}
      currentProfileId={profile.id}
      aiActivity={aiActivity}
      fiche={{ card: <JobSearchCard data={data} />, ...jobSearchFicheLinks(jobSearch, t) }}
      introduction={<p>{t("jobSearch.conversation.introduction", { date: day, profile: profile.name })}</p>}
      suggestions={SUGGESTIONS.map((suggestion) => ({
        label: t(`jobSearch.conversation.suggestions.${suggestion}.label`),
        message: t(`jobSearch.conversation.suggestions.${suggestion}.message`),
      }))}
    >
      {jobSearch.status === "searching" ? <RefreshWhileSearching /> : null}
      {children}
    </ObjectConversation>
  );
}

/** The Job Search at a glance, first in its Fiche: what the page's head showed, and searching again or stopping it. */
function JobSearchCard({ data }: { data: JobSearchPageData }) {
  const { jobSearch, t, locale, industries } = data;
  const { profile, status } = jobSearch;
  const startedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: TIME_ZONE }).format(jobSearch.startedAt);
  return (
    <div className="job-search-card">
      <dl className="props">
        <div className="prop">
          <dt>{t("jobSearch.status")}</dt>
          <dd>
            <span className="pill" data-tone={STATUS_TONE[status]}>
              {t(`jobSearch.statuses.${status}`)}
            </span>
          </dd>
        </div>
        <div className="prop">
          <dt>{t("jobSearch.startedOn")}</dt>
          <dd>{startedAt}</dd>
        </div>
        <div className="prop">
          <dt>{t("jobSearch.criteria")}</dt>
          <dd>
            <span>{searchCriteriaInWords(profile.searchCriteria, t, locale, industries)}</span>{" "}
            <SearchCriteriaDialog profileId={profile.id} profileName={profile.name} searchCriteria={profile.searchCriteria} />
          </dd>
        </div>
      </dl>
      <JobSearchOutcome data={data} />
      {status === "searching" ? (
        <StopJobSearchButton jobSearchId={jobSearch.id} />
      ) : (
        <StartJobSearchButton profileId={profile.id} label={t("jobSearch.searchAgain")} variant="secondary" icon={<Icons.searchAgain />} />
      )}
    </div>
  );
}
