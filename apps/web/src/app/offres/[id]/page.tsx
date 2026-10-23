import type { JobOffer } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAiActivity } from "@/ai-activity/server";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { SaveJobOfferForm } from "@/components/ApplicationControls";
import { CoachInView } from "@/components/CoachPanel";
import { ExpiredJobOfferNotice, JobOfferView } from "@/components/JobOfferView";
import { matchScoreFigure, matchScoreReasons } from "@/components/job-search-words";
import { ProfileMatchScore } from "@/components/MatchScoreWhy";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobOffers } from "@/job-offers/server";
import { jobOfferMatch } from "@/match-score/job-offer-match";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };
/** `profil`: the Profile to score the Job Offer against first (see `routes.jobOffer`). */
type SearchParams = { searchParams: Promise<{ profil?: string | string[] }> };

async function jobOfferOrNotFound(id: string) {
  const jobOffer = await getJobOffers().get(id);
  if (!jobOffer) notFound();
  return jobOffer;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const jobOffer = await jobOfferOrNotFound((await params).id);
  return { title: `${jobOffer.title} · ${t("app.name")}` };
}

/**
 * A Job Offer page: the posting cleanly laid out, and for a signed-in Candidate,
 * its Match Score with why, and saving it as an Application with the Profile
 * they pick (or a link to the one they have, and its score). Job Offers are not
 * personal data: anyone with the link can read it.
 */
export default async function JobOfferPage({ params, searchParams }: Params & SearchParams) {
  const jobOffer = await jobOfferOrNotFound((await params).id);
  const { profil } = await searchParams;
  const [t, locale, candidate] = await Promise.all([getServerT(), getRequestLocale(), getCurrentCandidate()]);
  const inView = { kind: "job_offer", id: jobOffer.id, name: jobOffer.title } as const;
  const page = (
    <>
      {candidate ? null : <h1>{jobOffer.title}</h1>}
      {candidate ? <CoachInView {...inView} /> : null}
      <ExpiredJobOfferNotice jobOffer={jobOffer} t={t} locale={locale} />
      <section className="stack" aria-labelledby="save-job-offer">
        <h2 id="save-job-offer">{t("jobOffer.saveTitle")}</h2>
        {candidate ? (
          <SaveOrSeeApplication candidateId={candidate.id} jobOffer={jobOffer} profileId={typeof profil === "string" ? profil : undefined} />
        ) : (
          <Link className="button button-primary" href={routes.signIn}>
            {t("jobOffer.signInToSave")}
          </Link>
        )}
      </section>
      <JobOfferView jobOffer={jobOffer} t={t} locale={locale} />
    </>
  );
  if (candidate)
    return (
      <CandidateLayout candidateId={candidate.id} title={jobOffer.title} aiActivity={await loadAiActivity.jobOffer(candidate.id, { id: jobOffer.id, title: jobOffer.title })}>
        {page}
      </CandidateLayout>
    );
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <nav className="page-nav">
          <TextSizeControl />
        </nav>
      </header>
      {page}
    </main>
  );
}

/**
 * The Job Offer's Match Score, as Job Search results give it: against the
 * Profile its Application uses once saved, otherwise against the active Profile
 * the Candidate picks to save it with (`profileId` first, if given).
 */
async function SaveOrSeeApplication({ candidateId, jobOffer, profileId }: { candidateId: string; jobOffer: JobOffer; profileId: string | undefined }) {
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const [applications, summaries] = await Promise.all([getApplications().list(candidateId), getProfiles().list(candidateId)]);
  const profiles = (await Promise.all(summaries.map((summary) => getProfiles().get(candidateId, summary.id)))).filter((profile) => profile !== null);
  const match = jobOfferMatch({ jobOffer, profiles, applications, profileId });
  if (!match) {
    return (
      <Link className="button button-primary" href={routes.newProfile}>
        {t("jobOffer.createProfileToSave")}
      </Link>
    );
  }
  if (match.saved) {
    return (
      <>
        <p>{t("jobOffer.alreadySaved")}</p>
        <ProfileMatchScore profileName={match.profile.name} figure={matchScoreFigure(match.matchScore)} reasons={matchScoreReasons(match.matchScore, t, locale)} t={t} />
        <Link className="button button-primary" href={routes.application(match.applicationId)}>
          {t("jobOffer.seeApplication")}
        </Link>
      </>
    );
  }
  const choices = match.matches.map(({ profile, matchScore }) => ({
    ...profile,
    matchScore: { figure: matchScoreFigure(matchScore), reasons: matchScoreReasons(matchScore, t, locale) },
  }));
  return <SaveJobOfferForm jobOfferId={jobOffer.id} profiles={choices} profileId={match.profileId} />;
}
