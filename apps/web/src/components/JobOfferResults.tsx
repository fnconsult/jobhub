import type { JobOffer, MatchScore } from "@jobhub/shared";
import type { TFunction } from "i18next";
import Link from "next/link";
import { SaveSearchResultButton } from "@/components/JobSearchControls";
import { jobOfferSalary, jobOfferSite } from "@/components/JobOfferView";
import { MatchScoreWhy } from "@/components/MatchScoreWhy";
import { matchScoreFigure, matchScoreInWords, matchScoreReasons, matchScoreWhyInWords } from "@/components/job-search-words";
import { routes } from "@/routes";

/** One Job Offer found for a Profile: by a Job Search, or in a Job Digest. */
export interface JobOfferResult {
  jobOffer: JobOffer;
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it. */
  applicationId: string | null;
}

/**
 * Job Offers found for a Profile, in the order given (best Match Score first),
 * as the rows of the prototype (#132): the title (to the Job Offer), its key
 * facts on one line (its Posting date, or "date inconnue"), the Match Score
 * with a meter, a one-click save as an Application with that Profile and a
 * link to read the Job Offer (once saved: the Application, marked "Enregistrée"),
 * and "Pourquoi 86 ?" opening the score's reasons.
 * The results view of Job Searches and Job Digests. Each title is a level-2
 * heading, or `headingLevel` under a heading of the page's own (results grouped by Profile);
 * `label` names the list (default "Offres trouvées").
 */
export function JobOfferResults({
  results,
  profileId,
  t,
  locale,
  headingLevel = 2,
  label,
}: {
  results: JobOfferResult[];
  profileId: string;
  t: TFunction;
  locale: string;
  headingLevel?: 2 | 3 | 4;
  label?: string;
}) {
  return (
    <ol className="rows" aria-label={label ?? t("jobSearch.resultsLabel")}>
      {results.map((result) => (
        <Result key={result.jobOffer.id} result={result} profileId={profileId} t={t} locale={locale} headingLevel={headingLevel} />
      ))}
    </ol>
  );
}

function Result({ result, profileId, t, locale, headingLevel }: { result: JobOfferResult; profileId: string; t: TFunction; locale: string; headingLevel: 2 | 3 | 4 }) {
  const Heading = (["h2", "h3", "h4"] as const)[headingLevel - 2]!;
  const { jobOffer, matchScore, applicationId } = result;
  // The same Job Offer can be found for two Profiles shown on one page: one id each.
  const titleId = `search-result-${profileId}-${jobOffer.id}`;
  const site = jobOfferSite(jobOffer);
  const postedOn = jobOffer.postedAt
    ? t("jobSearch.postedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(jobOffer.postedAt)) })
    : null;
  const facts: Array<[key: string, fact: React.ReactNode]> = [
    ["employer", jobOffer.employer],
    ["location", jobOffer.location],
    ["contract", jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null],
    ["remote", jobOffer.remoteWork ? t("jobSearch.remoteWork", { option: t(`cvReview.remoteWorkOptions.${jobOffer.remoteWork}`) }) : null],
    ["salary", jobOfferSalary(jobOffer, t, locale)],
    // The freshness rule (#116): an undated Job Offer is labelled so, never left without a word.
    ["posted", postedOn ?? <span className="date-unknown">{t("jobOffer.dateUnknown")}</span>],
    ["source", site ? t("jobSearch.source", { site }) : null],
  ];
  const figure = matchScoreFigure(matchScore);
  const { score } = figure;
  return (
    <li className="row">
      <div className="row-main">
        <Heading className="row-title" id={titleId}>
          <Link href={routes.jobOffer(jobOffer.id, profileId)}>{jobOffer.title}</Link>
        </Heading>
        <p className="row-meta">
          {facts.map(([key, fact]) => (fact ? <span key={key}>{fact}</span> : null))}
        </p>
      </div>
      <div className="row-side">
        <p className="score">
          <span className="visually-hidden">{t("jobSearch.scoreLabel")}</span>
          {figure.reliability === "reliable" ? (
            <>
              <strong>{score}</strong> {t("jobSearch.outOf")}
            </>
          ) : (
            // Partial or not computable (#94): said in words, never a bare figure that reads as confident.
            <strong>{matchScoreInWords(figure, t)}</strong>
          )}
        </p>
        {figure.reliability === "not_computable" ? null : (
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
          </span>
        )}
      </div>
      <div className="row-actions">
        {applicationId ? (
          <>
            <Link className="button" href={routes.application(applicationId)} aria-describedby={titleId}>
              {t("jobSearch.seeApplication")}
            </Link>
            <span className="pill" data-tone="accent">
              {t("jobSearch.savedPill")}
            </span>
          </>
        ) : (
          <>
            <SaveSearchResultButton jobOfferId={jobOffer.id} profileId={profileId} describedBy={titleId} />
            <Link className="button button-quiet" href={routes.jobOffer(jobOffer.id, profileId)} aria-describedby={titleId}>
              {t("jobSearch.seeJobOffer")}
            </Link>
          </>
        )}
        <MatchScoreWhy summary={matchScoreWhyInWords(figure, t)} reasons={matchScoreReasons(matchScore, t, locale)} />
      </div>
    </li>
  );
}
