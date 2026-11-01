import type { JobOffer, MatchScore } from "@jobhub/shared";
import type { TFunction } from "i18next";
import Link from "next/link";
import { SaveSearchResultButton } from "@/components/JobSearchControls";
import { jobOfferSalary, jobOfferSite } from "@/components/JobOfferView";
import { MatchScoreWhy } from "@/components/MatchScoreWhy";
import { matchScoreFigure, matchScoreInWords, matchScoreReasons, matchScoreWhyInWords } from "@/components/job-search-words";
import { buttonClass } from "@/design/button-class";
import { Pill } from "@/design/Pill";
import { Ring } from "@/design/Ring";
import { routes } from "@/routes";
import "./JobOfferResults.css";

/** One Job Offer found for a Profile: by a Job Search, or in a Job Digest. */
export interface JobOfferResult {
  jobOffer: JobOffer;
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it. */
  applicationId: string | null;
}

/**
 * Job Offers found for a Profile, in the order given (best Match Score first), as Job Offer cards (#467, the
 * Design System's prototype `#candidat`): the title (to the Job Offer) and its key facts on one line (its Posting
 * date, or "date inconnue"); the Match Score in its own column, a ring around the figure, said in words for screen
 * readers; the contract and remote work as pills; then a one-click save as an Application with that Profile and a
 * link to read the Job Offer (once saved: the Application, and the pill "Enregistrée"), and "Pourquoi 86 ?" opening
 * the score's reasons.
 * The results view of Job Searches and Job Digests. Each title is a level-2
 * heading, or `headingLevel` under a heading of the page's own (results grouped by Profile);
 * `label` names the list (default "Offres trouvées"); `idScope` keeps its titles' ids apart from another list of the
 * same Profile's Job Offers on the page (« Reçues par email », #447). `offerHref`: where a Job Offer's title and « Lire
 * l'offre » lead, its page by default; under « Conversation au centre », the Work Pane beside the conversation (#605).
 */
export function JobOfferResults({
  results,
  profileId,
  t,
  locale,
  headingLevel = 2,
  label,
  idScope = "search-result",
  offerHref,
}: {
  results: JobOfferResult[];
  profileId: string;
  t: TFunction;
  locale: string;
  headingLevel?: 2 | 3 | 4 | 5;
  label?: string;
  idScope?: string;
  offerHref?: (jobOfferId: string) => string;
}) {
  return (
    <ol className="job-offer-results" aria-label={label ?? t("jobSearch.resultsLabel")}>
      {results.map((result) => (
        <JobOfferCard
          key={result.jobOffer.id}
          result={result}
          profileId={profileId}
          t={t}
          locale={locale}
          headingLevel={headingLevel}
          idScope={idScope}
          href={offerHref ? offerHref(result.jobOffer.id) : routes.jobOffer(result.jobOffer.id, profileId)}
        />
      ))}
    </ol>
  );
}

function JobOfferCard({
  result,
  profileId,
  t,
  locale,
  headingLevel,
  idScope,
  href,
}: {
  result: JobOfferResult;
  profileId: string;
  t: TFunction;
  locale: string;
  headingLevel: 2 | 3 | 4 | 5;
  idScope: string;
  href: string;
}) {
  const Heading = (["h2", "h3", "h4", "h5"] as const)[headingLevel - 2]!;
  const { jobOffer, matchScore, applicationId } = result;
  // The same Job Offer can be found for two Profiles shown on one page: one id each.
  const titleId = `${idScope}-${profileId}-${jobOffer.id}`;
  const site = jobOfferSite(jobOffer);
  const postedOn = jobOffer.postedAt
    ? t("jobSearch.postedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(jobOffer.postedAt)) })
    : null;
  const facts: Array<[key: string, fact: React.ReactNode]> = [
    ["employer", jobOffer.employer],
    ["location", jobOffer.location],
    ["salary", jobOfferSalary(jobOffer, t, locale)],
    // The freshness rule (#116): an undated Job Offer is labelled so, never left without a word.
    ["posted", postedOn ?? <span className="date-unknown">{t("jobOffer.dateUnknown")}</span>],
    ["source", site ? t("jobSearch.source", { site }) : null],
  ];
  const pills = [
    jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null,
    jobOffer.remoteWork ? t("jobSearch.remoteWork", { option: t(`cvReview.remoteWorkOptions.${jobOffer.remoteWork}`) }) : null,
  ].filter((pill): pill is string => Boolean(pill));
  const figure = matchScoreFigure(matchScore);
  return (
    <li className="job-offer-result">
      <div className="job-offer-result__main">
        <Heading className="job-offer-result__title" id={titleId}>
          <Link href={href}>{jobOffer.title}</Link>
        </Heading>
        <p className="job-offer-result__meta">
          {facts.map(([key, fact]) => (fact ? <span key={key}>{fact}</span> : null))}
        </p>
      </div>
      <div className="job-offer-result__score">
        {/* Said once, in words: the ring and its caption only draw it (#94: partial or not computable in words too). */}
        <p className="visually-hidden">
          {t("jobSearch.scoreLabel")}
          {matchScoreInWords(figure, t)}
        </p>
        {figure.reliability === "not_computable" ? (
          <span className="job-offer-result__none" aria-hidden>
            {matchScoreInWords(figure, t)}
          </span>
        ) : (
          <Ring decorative value={figure.score} />
        )}
        <span className="job-offer-result__caption" aria-hidden>
          {t(figure.reliability === "partial" ? "jobSearch.partialCaption" : "jobSearch.matchScoreCaption")}
        </span>
      </div>
      {pills.length > 0 || applicationId ? (
        <p className="job-offer-result__pills">
          {pills.map((pill) => (
            <Pill key={pill}>{pill}</Pill>
          ))}
          {applicationId ? <Pill tone="accent">{t("jobSearch.savedPill")}</Pill> : null}
        </p>
      ) : null}
      <div className="job-offer-result__actions">
        {applicationId ? (
          <Link className={buttonClass({ size: "sm" })} href={routes.application(applicationId)} aria-describedby={titleId}>
            {t("jobSearch.seeApplication")}
          </Link>
        ) : (
          <>
            <SaveSearchResultButton jobOfferId={jobOffer.id} profileId={profileId} describedBy={titleId} />
            <Link className={buttonClass({ size: "sm" })} href={href} aria-describedby={titleId}>
              {t("jobSearch.seeJobOffer")}
            </Link>
          </>
        )}
        <MatchScoreWhy summary={matchScoreWhyInWords(figure, t)} reasons={matchScoreReasons(matchScore, t, locale)} />
      </div>
    </li>
  );
}
