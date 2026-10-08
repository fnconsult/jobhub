import type { Metadata } from "next";
import Link from "next/link";
import { getActionCards } from "@/action-cards/server";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { requireOwnApplication } from "@/applications/server";
import { ActionCardList } from "@/components/ActionCardList";
import { AddInterviewForm, ApplicationProfileSelect, ApplicationStatusSelect, RemoveInterviewButton } from "@/components/ApplicationControls";
import { CoachInView } from "@/components/CoachPanel";
import { CompanyDossierView } from "@/components/CompanyDossierView";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { JobOfferView } from "@/components/JobOfferView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { TailoredDocumentsEditor } from "@/components/TailoredDocumentsEditor";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { getTailoredDocuments } from "@/tailored-documents/server";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { application } = await requireOwnApplication((await params).id);
  return { title: `${application.jobOffer.title} · ${t("app.name")}` };
}

/**
 * One Application: its status and Profile (both changed by hand), its Interviews,
 * the Match Score with its breakdown, its Cover Letter and Outreach Message drafts, the Company Dossier and the full Job Offer.
 */
export default async function ApplicationPage({ params }: Params) {
  const { candidateId, application } = await requireOwnApplication((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const inView = { kind: "application", id: application.id, name: application.jobOffer.title } as const;
  const [cards, profiles, companyDossier, drafts] = await Promise.all([
    getActionCards().pending(candidateId, inView),
    getProfiles().list(candidateId),
    getCompanyDossiers().get(candidateId, application.id),
    getTailoredDocuments().get(candidateId, application.id),
  ]);
  // Active Profiles to pick from, and the one in use even if it was archived since.
  const choices = profiles.filter((profile) => !profile.archived || profile.id === application.profile.id).map(({ id, name }) => ({ id, name }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const { jobOffer, interviews } = application;
  return (
    <main className="page">
      <WorkspaceHeader candidateId={candidateId} />
      <p>
        <Link href={routes.applications}>{t("application.backToApplications")}</Link>
      </p>
      <h1>{jobOffer.title}</h1>
      {jobOffer.employer ? <p className="lead">{jobOffer.employer}</p> : null}
      <p>{t("application.savedOn", { date: date.format(application.createdAt) })}</p>
      <CoachInView {...inView} />
      <ActionCardList key={application.id} cards={cards.map(({ id, title, body }) => ({ id, title, body }))} />

      <div className="stack">
        <ApplicationStatusSelect applicationId={application.id} status={application.status} />
        <ApplicationProfileSelect applicationId={application.id} profileId={application.profile.id} profiles={choices} />
      </div>

      <section className="stack" aria-labelledby="interviews-title">
        <h2 id="interviews-title">{t("application.interviewsTitle")}</h2>
        {interviews.length > 0 ? (
          <ul className="interview-list">
            {interviews.map((interview) => {
              const when = dateTime.format(interview.scheduledAt);
              return (
                <li key={interview.id} className="interview">
                  <p className="interview-date">{when}</p>
                  {interview.note ? <p>{interview.note}</p> : null}
                  <RemoveInterviewButton applicationId={application.id} interviewId={interview.id} label={t("application.removeInterview", { date: when })} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t("application.interviewsNone")}</p>
        )}
        {application.status === "interview" ? <AddInterviewForm applicationId={application.id} /> : <p className="hint">{t("application.interviewsHint")}</p>}
      </section>

      <MatchScoreView matchScore={application.matchScore} profileName={application.profile.name} t={t} locale={locale} />
      <CompanyDossierView applicationId={application.id} state={companyDossier} t={t} locale={locale} />
      {drafts ? <TailoredDocumentsEditor key={`drafts-${application.id}`} applicationId={application.id} initial={drafts} /> : null}
      <JobOfferView jobOffer={jobOffer} t={t} locale={locale} />
    </main>
  );
}
