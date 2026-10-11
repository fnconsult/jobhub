import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { SaveJobOfferForm } from "@/components/ApplicationControls";
import { ExpiredJobOfferNotice, JobOfferView } from "@/components/JobOfferView";
import { TextSizeControl } from "@/components/TextSizeControl";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobOffers } from "@/job-offers/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

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
 * saving it as an Application with the Profile they pick (or a link to the one
 * they have). Job Offers are not personal data: anyone with the link can read it.
 */
export default async function JobOfferPage({ params }: Params) {
  const jobOffer = await jobOfferOrNotFound((await params).id);
  const [t, locale, candidate] = await Promise.all([getServerT(), getRequestLocale(), getCurrentCandidate()]);
  return (
    <main className="page">
      {candidate ? (
        <WorkspaceHeader candidateId={candidate.id} />
      ) : (
        <header className="page-header">
          <Link className="brand" href={routes.home}>
            {t("app.name")}
          </Link>
          <nav className="page-nav">
            <TextSizeControl />
          </nav>
        </header>
      )}
      <h1>{jobOffer.title}</h1>
      <ExpiredJobOfferNotice jobOffer={jobOffer} t={t} locale={locale} />
      <section className="stack" aria-labelledby="save-job-offer">
        <h2 id="save-job-offer">{t("jobOffer.saveTitle")}</h2>
        {candidate ? <SaveOrSeeApplication candidateId={candidate.id} jobOfferId={jobOffer.id} /> : (
          <Link className="button button-primary" href={routes.signIn}>
            {t("jobOffer.signInToSave")}
          </Link>
        )}
      </section>
      <JobOfferView jobOffer={jobOffer} t={t} locale={locale} />
    </main>
  );
}

async function SaveOrSeeApplication({ candidateId, jobOfferId }: { candidateId: string; jobOfferId: string }) {
  const t = await getServerT();
  const [applications, profiles] = await Promise.all([getApplications().list(candidateId), getProfiles().list(candidateId)]);
  const existing = applications.find((application) => application.jobOffer.id === jobOfferId);
  if (existing) {
    return (
      <>
        <p>{t("jobOffer.alreadySaved")}</p>
        <Link className="button button-primary" href={routes.application(existing.id)}>
          {t("jobOffer.seeApplication")}
        </Link>
      </>
    );
  }
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  if (active.length === 0) {
    return (
      <Link className="button button-primary" href={routes.newProfile}>
        {t("jobOffer.createProfileToSave")}
      </Link>
    );
  }
  return <SaveJobOfferForm jobOfferId={jobOfferId} profiles={active} />;
}
