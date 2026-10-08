import type { Metadata } from "next";
import Link from "next/link";
import type { ActionCard } from "@/action-cards";
import { getActionCards } from "@/action-cards/server";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { requireOwnApplication } from "@/applications/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AddInterviewForm, ApplicationProfileSelect, ApplicationStatusSelect, RemoveInterviewButton } from "@/components/ApplicationControls";
import { CoachInView } from "@/components/CoachPanel";
import { CoachReviewList } from "@/components/CoachReviewList";
import { CompanyDossierView } from "@/components/CompanyDossierView";
import { EnrichedContactsPanel } from "@/components/EnrichedContactsPanel";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { JobOfferView } from "@/components/JobOfferView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { TailoredCvReview } from "@/components/TailoredCvReview";
import { TailoredDocumentsEditor } from "@/components/TailoredDocumentsEditor";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { ABANDON_CARD, FOLLOW_UP_CARD, followUpCardApplies, type FollowUpPayload } from "@/follow-ups";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";

type Params = { params: Promise<{ id: string }> };
type T = Awaited<ReturnType<typeof getServerT>>;

/** How an Action Card on an Application shows: a Follow-up draft is to send, then mark as sent (drafts only, ADR-0005). */
function cardView({ id, kind, title, body, payload }: ActionCard, t: T): ActionCardView {
  if (kind === FOLLOW_UP_CARD) {
    const { subject } = (payload ?? {}) as Partial<FollowUpPayload>;
    return {
      id,
      title,
      body: subject ? `${t("followUps.subject", { subject })}\n\n${body}` : body,
      label: t("followUps.cardLabel"),
      acceptLabel: t("followUps.markSent"),
      hint: t("followUps.sentHint"),
    };
  }
  if (kind === ABANDON_CARD) return { id, title, body, label: t("followUps.abandonLabel"), acceptLabel: t("followUps.abandonAccept") };
  return { id, title, body };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { application } = await requireOwnApplication((await params).id);
  return { title: `${application.jobOffer.title} · ${t("app.name")}` };
}

/**
 * One Application: its status and Profile (both changed by hand), its Interviews,
 * the Match Score with its breakdown, its Tailored CV under review or saved, its Cover Letter and Outreach Message drafts,
 * the Human Coaches' Coach Reviews of them, the Company Dossier, its Enriched Contacts (when a contact-data provider is on) and the full Job Offer.
 */
export default async function ApplicationPage({ params }: Params) {
  const { candidateId, application } = await requireOwnApplication((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const inView = { kind: "application", id: application.id, name: application.jobOffer.title } as const;
  const [cards, profiles, companyDossier, enrichedContacts, tailoredCv, drafts, coachReviews] = await Promise.all([
    getActionCards().pending(candidateId, inView),
    getProfiles().list(candidateId),
    getCompanyDossiers().get(candidateId, application.id),
    getEnrichedContacts().get(candidateId, application.id),
    getTailoredCvs().get(candidateId, application.id),
    getTailoredDocuments().get(candidateId, application.id),
    getHumanCoaches().reviews(candidateId, application.id),
  ]);
  // Active Profiles to pick from, and the one in use even if it was archived since.
  const choices = profiles.filter((profile) => !profile.archived || profile.id === application.profile.id).map(({ id, name }) => ({ id, name }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const { jobOffer, interviews } = application;
  const recipients = (enrichedContacts?.contacts ?? []).map(({ id, name, jobTitle, emails }) => ({ id, name, ...(jobTitle && { jobTitle }), ...(emails[0] && { email: emails[0] }) }));
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
      <ActionCardList key={application.id} cards={cards.filter((card) => followUpCardApplies(card, application.status)).map((card) => cardView(card, t))} />

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
      {enrichedContacts && (enrichedContacts.enabled || enrichedContacts.contacts.length > 0) ? (
        <EnrichedContactsPanel
          key={`enriched-contacts-${application.id}`}
          applicationId={application.id}
          initial={enrichedContacts}
          hasDossier={companyDossier?.status === "built"}
          locale={locale}
        />
      ) : null}
      {tailoredCv ? <TailoredCvReview key={`tailored-cv-${application.id}`} applicationId={application.id} initial={tailoredCv} locale={locale} /> : null}
      {drafts ? <TailoredDocumentsEditor key={`drafts-${application.id}`} applicationId={application.id} initial={drafts} recipients={recipients} /> : null}
      <CoachReviewList reviews={coachReviews} />
      <JobOfferView jobOffer={jobOffer} t={t} locale={locale} />
    </main>
  );
}
