import type { Metadata } from "next";
import Link from "next/link";
import type { ActionCard } from "@/action-cards";
import { getActionCards } from "@/action-cards/server";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { requireOwnApplication } from "@/applications/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import {
  AddInterviewForm,
  ApplicationProfileSelect,
  ApplicationStatusSelect,
  EditInterview,
  RemoveInterviewButton,
  ReportUnavailableButton,
} from "@/components/ApplicationControls";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { CoachReviewList } from "@/components/CoachReviewList";
import { CompanyDossierView } from "@/components/CompanyDossierView";
import { EnrichedContactsPanel } from "@/components/EnrichedContactsPanel";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { ExpiredJobOfferNotice, JobOfferView, jobOfferSite } from "@/components/JobOfferView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { TailoredDocuments } from "@/components/TailoredDocuments";
import { ABANDON_CARD, FOLLOW_UP_CARD, followUpCardApplies, type FollowUpPayload } from "@/follow-ups";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { jobOfferAtAGlance } from "@/job-offers/at-a-glance";
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
      draft: true,
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
 * One Application, laid out as a document (the Notion-like prototype, #132): its
 * title, the Job Offer at a glance and its properties (status and Profile, both
 * changed in place; Match Score; when it was saved; the Job Offer's site), then
 * whether its Job Offer is expired or Reported Unavailable by the Candidate (who
 * can report it, and undo that), the AI Coach's Action Cards, the Tailored
 * Documents in tabs (the Tailored CV under review or saved, the Cover Letter and
 * Outreach Message drafts), the Match Score's breakdown, the Interviews, the
 * Human Coaches' Coach Reviews, the Company Dossier, its Enriched Contacts (when
 * a contact-data provider is on) and the full Job Offer.
 */
export default async function ApplicationPage({ params }: Params) {
  const { candidateId, application } = await requireOwnApplication((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const inView = { kind: "application", id: application.id, name: application.jobOffer.title, profileId: application.profile.id } as const;
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
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const { jobOffer, interviews } = application;
  const atAGlance = jobOfferAtAGlance(jobOffer, t, locale);
  const site = jobOfferSite(jobOffer);
  const recipients = (enrichedContacts?.contacts ?? []).map(({ id, name, jobTitle, emails }) => ({ id, name, ...(jobTitle && { jobTitle }), ...(emails[0] && { email: emails[0] }) }));
  return (
    <CandidateLayout candidateId={candidateId}>
      <div className="doc">
        <header className="page-head">
          <p className="eyebrow">
            <Link href={routes.applications}>{t("application.backToApplications")}</Link>
          </p>
          <h1>{jobOffer.title}</h1>
          {atAGlance ? <p className="lead">{atAGlance}</p> : null}
          <dl className="props">
            <ApplicationStatusSelect applicationId={application.id} status={application.status} property />
            <ApplicationProfileSelect applicationId={application.id} profileId={application.profile.id} profiles={choices} />
            <div className="prop">
              <dt>{t("application.matchLabel")}</dt>
              <dd>
                <span className="score">{t("matchScore.score", { score: application.matchScore.score })}</span>
                <a href="#match-score-title">{t("application.matchDetail")}</a>
              </dd>
            </div>
            <div className="prop">
              <dt>{t("application.savedOnLabel")}</dt>
              <dd>{fullDate.format(application.createdAt)}</dd>
            </div>
            {jobOffer.source.url && site ? (
              <div className="prop">
                <dt>{t("application.offerLabel")}</dt>
                <dd>
                  <a href={jobOffer.source.url} rel="noopener noreferrer nofollow" target="_blank">
                    {t("jobOffer.sourceLink", { site })}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </header>

        <ExpiredJobOfferNotice jobOffer={jobOffer} t={t} locale={locale}>
          {t("application.expiredNotice")}
        </ExpiredJobOfferNotice>
        {application.reportedUnavailableAt ? (
          <div className="notice notice-expired" role="status">
            <p>
              <span className="expired-flag">{t("applications.expired")}</span>
              <span className="reported-flag">{t("applications.reportedByYou")}</span>
            </p>
            <p>{t("application.reportedNotice", { date: date.format(application.reportedUnavailableAt) })}</p>
          </div>
        ) : null}
        {/* Reported Unavailable: for an offer not (yet) found expired, or to undo a report. */}
        {!jobOffer.expiredAt || application.reportedUnavailableAt ? (
          <ReportUnavailableButton applicationId={application.id} reported={Boolean(application.reportedUnavailableAt)} />
        ) : null}
        <CoachInView {...inView} />
        <ActionCardList key={application.id} cards={cards.filter((card) => followUpCardApplies(card, application.status)).map((card) => cardView(card, t))} />

        {tailoredCv || drafts ? (
          <TailoredDocuments
            key={`documents-${application.id}`}
            applicationId={application.id}
            documentLanguage={drafts?.documentLanguage ?? tailoredCv!.documentLanguage}
            tailoredCv={tailoredCv}
            drafts={drafts}
            recipients={recipients}
            locale={locale}
          />
        ) : null}

        <MatchScoreView matchScore={application.matchScore} profileName={application.profile.name} t={t} locale={locale} />

        <section className="section" aria-labelledby="interviews-title">
          <div className="section-head">
            <h2 id="interviews-title">{t("application.interviewsTitle")}</h2>
          </div>
          {interviews.length > 0 ? (
            <ul className="interview-list">
              {interviews.map((interview) => {
                const when = dateTime.format(interview.scheduledAt);
                return (
                  <li key={interview.id} className="interview">
                    <p className="interview-date">{when}</p>
                    {interview.note ? <p>{interview.note}</p> : null}
                    <div className="actions">
                      <EditInterview
                        applicationId={application.id}
                        interview={{ id: interview.id, scheduledAt: interviewWallClock(interview.scheduledAt), note: interview.note }}
                        label={t("application.editInterview", { date: when })}
                      />
                      <RemoveInterviewButton applicationId={application.id} interviewId={interview.id} label={t("application.removeInterview", { date: when })} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>{t("application.interviewsNone")}</p>
          )}
          {application.status === "interview" ? <AddInterviewForm applicationId={application.id} /> : <p className="hint">{t("application.interviewsHint")}</p>}
        </section>

        <CoachReviewList reviews={coachReviews} />
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
        <JobOfferView jobOffer={jobOffer} t={t} locale={locale} />
      </div>
    </CandidateLayout>
  );
}
