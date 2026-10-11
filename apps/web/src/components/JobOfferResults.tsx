import type { JobOffer, MatchScore } from "@jobhub/shared";
import type { TFunction } from "i18next";
import Link from "next/link";
import { SaveSearchResultButton } from "@/components/JobSearchControls";
import { jobOfferSalary, jobOfferSite } from "@/components/JobOfferView";
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
 * each with its key facts and a one-click save as an Application with that
 * Profile. The results view of Job Searches and Job Digests.
 */
export function JobOfferResults({ results, profileId, t, locale }: { results: JobOfferResult[]; profileId: string; t: TFunction; locale: string }) {
  return (
    <ol className="search-results">
      {results.map((result) => (
        <Result key={result.jobOffer.id} result={result} profileId={profileId} t={t} locale={locale} />
      ))}
    </ol>
  );
}

function Result({ result, profileId, t, locale }: { result: JobOfferResult; profileId: string; t: TFunction; locale: string }) {
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
