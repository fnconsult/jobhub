import type { CriterionStatus, JobOffer, MatchScore } from "@jobhub/shared";
import type { TFunction } from "i18next";
import Link from "next/link";
import { SaveSearchResultButton } from "@/components/JobSearchControls";
import { jobOfferSalary, jobOfferSite } from "@/components/JobOfferView";
import { matchScoreReasons } from "@/components/job-search-words";
import { routes } from "@/routes";

/** One Job Offer found for a Profile: by a Job Search, or in a Job Digest. */
export interface JobOfferResult {
  jobOffer: JobOffer;
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it. */
  applicationId: string | null;
}

/** A verdict is said in words; the colour only reinforces a clear match or mismatch. */
const VERDICT_TONE: Partial<Record<CriterionStatus, string>> = { match: "success", mismatch: "danger" };

/**
 * Job Offers found for a Profile, in the order given (best Match Score first),
 * as the rows of the prototype (#132): the title (to the Job Offer), its key
 * facts on one line (its Posting date, or "date inconnue"), the Match Score
 * with a meter, a one-click save as an Application with that Profile (or the
 * Application once saved), and "Pourquoi 86 ?" opening the score's reasons.
 * The results view of Job Searches and Job Digests.
 */
export function JobOfferResults({ results, profileId, t, locale }: { results: JobOfferResult[]; profileId: string; t: TFunction; locale: string }) {
  return (
    <ol className="rows" aria-label={t("jobSearch.resultsLabel")}>
      {results.map((result) => (
        <Result key={result.jobOffer.id} result={result} profileId={profileId} t={t} locale={locale} />
      ))}
    </ol>
  );
}

function Result({ result, profileId, t, locale }: { result: JobOfferResult; profileId: string; t: TFunction; locale: string }) {
  const { jobOffer, matchScore, applicationId } = result;
  const titleId = `search-result-${jobOffer.id}`;
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
  const { score } = matchScore;
  return (
    <li className="row">
      <div className="row-main">
        <h2 className="row-title" id={titleId}>
          <Link href={routes.jobOffer(jobOffer.id)}>{jobOffer.title}</Link>
        </h2>
        <p className="row-meta">
          {facts.map(([key, fact]) => (fact ? <span key={key}>{fact}</span> : null))}
        </p>
      </div>
      <div className="row-side">
        <p className="score">
          <span className="visually-hidden">{t("jobSearch.scoreLabel")}</span>
          <strong>{score}</strong> {t("jobSearch.outOf")}
        </p>
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
        </span>
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
          <SaveSearchResultButton jobOfferId={jobOffer.id} profileId={profileId} describedBy={titleId} />
        )}
        <Link className="button button-quiet" href={routes.jobOffer(jobOffer.id)} aria-describedby={titleId}>
          {t("jobSearch.seeJobOffer")}
        </Link>
        <details className="why">
          <summary>{t("jobSearch.why", { score })}</summary>
          <ul className="breakdown">
            {matchScoreReasons(matchScore, t, locale).map((reason) => (
              <li key={reason.text}>
                <span className="verdict" data-tone={VERDICT_TONE[reason.status]}>
                  {reason.verdict}
                </span>
                <span>{reason.text}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
}
