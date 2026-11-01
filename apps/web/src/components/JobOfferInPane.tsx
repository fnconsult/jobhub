import type { TFunction } from "i18next";
import Link from "next/link";
import type { JobOfferResult } from "@/components/JobOfferResults";
import { SaveSearchResultButton } from "@/components/JobSearchControls";
import { ExpiredJobOfferNotice, JobOfferTiles, JobOfferView } from "@/components/JobOfferView";
import { ProfileMatchScore } from "@/components/MatchScoreWhy";
import { matchScoreFigure, matchScoreReasons } from "@/components/job-search-words";
import { buttonClass } from "@/design/button-class";
import { routes } from "@/routes";

/**
 * One Job Offer a Job Search found or a Job Digest brought, in the Work Pane beside its conversation (#605): its facts,
 * whether it is expired, its Match Score against the Profile with why, saving it as an Application with that Profile in
 * one click (once saved, the way to it), then its full text.
 */
export function JobOfferInPane({ result, profile, t, locale }: { result: JobOfferResult; profile: { id: string; name: string }; t: TFunction; locale: string }) {
  const { jobOffer, matchScore, applicationId } = result;
  return (
    <div className="job-offer-in-pane">
      <JobOfferTiles jobOffer={jobOffer} t={t} locale={locale} />
      <ExpiredJobOfferNotice jobOffer={jobOffer} t={t} locale={locale} />
      <ProfileMatchScore profileName={profile.name} figure={matchScoreFigure(matchScore)} reasons={matchScoreReasons(matchScore, t, locale)} t={t} />
      <div className="btn-row">
        {applicationId ? (
          <Link className={buttonClass({ size: "sm" })} href={routes.application(applicationId)}>
            {t("jobSearch.seeApplication")}
          </Link>
        ) : (
          <SaveSearchResultButton jobOfferId={jobOffer.id} profileId={profile.id} />
        )}
      </div>
      <JobOfferView jobOffer={jobOffer} t={t} locale={locale} details={false} />
    </div>
  );
}
