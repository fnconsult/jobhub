import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { ActionCard } from "@/action-cards";
import { getActionCards } from "@/action-cards/server";
import { agendaPeriod } from "@/agenda";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { requireOwnApplication } from "@/applications/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AddInterviewForm, EditInterview, RemoveInterviewButton } from "@/components/ApplicationControls";
import { CancelAgendaItemButton } from "@/components/CancelAgendaItemButton";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { InterviewFacts, InterviewTimes } from "@/components/InterviewDetails";
import { CoachReviewList } from "@/components/CoachReviewList";
import { CompanyDossierView } from "@/components/CompanyDossierView";
import { EnrichedContactsPanel } from "@/components/EnrichedContactsPanel";
import { JobOfferView } from "@/components/JobOfferView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { RescheduleHistory } from "@/components/RescheduleHistory";
import { TailoredDocuments } from "@/components/TailoredDocuments";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { ABANDON_CARD, FOLLOW_UP_CARD, followUpCardApplies, type FollowUpPayload } from "@/follow-ups";
import { getHumanCoaches } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { APPLICATION_SECTIONS, applicationResultOf, routes, type ApplicationResult, type ApplicationSection } from "@/routes";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { JobOfferSummary } from "@/components/JobOfferSummary";
import { JobOfferTiles } from "@/components/JobOfferView";
import { buttonClass } from "@/design/button-class";
import { EmptyState } from "@/design/EmptyState";
import { Pill } from "@/design/Pill";

export type Params = { params: Promise<{ id: string }> };
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

/**
 * Everything an Application's page shows, loaded once per request (the layout
 * and the Section shown share it), and which of its Sections there are, in
 * order (ADR-0024): Propositions while there are Action Cards, the Tailored
 * Documents once there are some, the Coach Reviews once there are some, and the
 * Enriched Contacts while a contact-data provider is on or some were found.
 * Sends anonymous visitors to sign in, and answers 404 for an Application that is not theirs.
 */
export const loadApplicationPage = cache(async (id: string) => {
  const { candidateId, application } = await requireOwnApplication(id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const inView = { kind: "application", id: application.id, name: application.jobOffer.title, profileId: application.profile.id } as const;
  const [pendingCards, profiles, companyDossier, enrichedContacts, tailoredCv, drafts, coachReviews] = await Promise.all([
    getActionCards().pending(candidateId, inView),
    getProfiles().list(candidateId),
    getCompanyDossiers().get(candidateId, application.id),
    getEnrichedContacts().get(candidateId, application.id),
    getTailoredCvs().get(candidateId, application.id),
    getTailoredDocuments().get(candidateId, application.id),
    getHumanCoaches().reviews(candidateId, application.id),
  ]);
  const shownCards = pendingCards.filter((card) => followUpCardApplies(card, application.status));
  const cards = shownCards.map((card) => cardView(card, t));
  const present: Record<ApplicationSection, boolean> = {
    propositions: cards.length > 0,
    documents: Boolean(tailoredCv || drafts),
    correspondance: true,
    entretiens: true,
    avis: coachReviews.length > 0,
    dossier: true,
    contacts: Boolean(enrichedContacts && (enrichedContacts.enabled || enrichedContacts.contacts.length > 0)),
    offre: true,
  };
  const sections = APPLICATION_SECTIONS.filter((section) => present[section]);
  // The Agenda, at its past Agenda Items when every Interview here is past there (before today).
  const now = new Date();
  const allPast = application.interviews.length > 0 && application.interviews.every((interview) => agendaPeriod(interview.scheduledAt, now) === "past");
  const agendaHref = routes.agenda(allPast);
  return { candidateId, application, t, locale, inView, cards, shownCards, profiles, companyDossier, enrichedContacts, tailoredCv, drafts, coachReviews, sections, agendaHref };
});

export type ApplicationPageData = Awaited<ReturnType<typeof loadApplicationPage>>;

/** What an Application's Section and Result are, in the Work Pane (#603). */
const SECTION: AddressedKind = "section";
const RESULT: AddressedKind = "result";

/**
 * One Section of an Application's page, at its own address. A Section there
 * is not (no Tailored Documents yet, say) answers 404, except Propositions: its
 * last Action Card accepted refreshes the page, which keeps saying it was.
 * It opens in the Work Pane beside the Application's conversation (#603, ADR-0070);
 * the « documents » Section shows one Result alone when its address names it (`result`: `?resultat=lettre`).
 */
export async function ApplicationSectionPage({ params, section, result }: Params & { section: ApplicationSection; result?: string | string[] }) {
  const data = await loadApplicationPage((await params).id);
  if (section !== "propositions" && !data.sections.includes(section)) notFound();
  const { application, t } = data;
  const back = routes.application(application.id);
  const alone = section === "documents" ? shownResult(data, applicationResultOf(result)) : null;
  if (alone)
    return (
      <InWorkPane kind={RESULT} title={resultTitle(alone, t)} href={routes.applicationResult(application.id, alone)} back={back}>
        <SectionView data={data} section={section} result={alone} />
      </InWorkPane>
    );
  return (
    <InWorkPane kind={SECTION} title={t(`application.sections.${section}`)} href={routes.applicationSection(application.id, section)} back={back}>
      <SectionView data={data} section={section} />
    </InWorkPane>
  );
}

/** The Result an address names, when the Application has it. */
function shownResult({ tailoredCv, drafts }: ApplicationPageData, result: ApplicationResult | null): ApplicationResult | null {
  if (result === "tailored_cv") return tailoredCv ? result : null;
  return result && drafts ? result : null;
}

function resultTitle(result: ApplicationResult, t: T): string {
  if (result === "tailored_cv") return t("tailoredCv.tailored");
  return t(result === "cover_letter" ? "tailoredDocuments.coverLetter.title" : "tailoredDocuments.outreachMessage.title");
}

function SectionView({ data, section, result }: { data: ApplicationPageData; section: ApplicationSection; result?: ApplicationResult }) {
  const { application, t, locale } = data;
  switch (section) {
    case "propositions":
      return <ActionCardList key={application.id} cards={data.cards} alone />;
    case "documents": {
      const { tailoredCv, drafts } = data;
      if (!tailoredCv && !drafts) return null;
      const recipients = (data.enrichedContacts?.contacts ?? []).map(({ id, name, jobTitle, emails }) => ({
        id,
        name,
        ...(jobTitle && { jobTitle }),
        ...(emails[0] && { email: emails[0] }),
      }));
      return (
        <TailoredDocuments
          key={`documents-${application.id}`}
          applicationId={application.id}
          documentLanguage={drafts?.documentLanguage ?? tailoredCv!.documentLanguage}
          tailoredCv={tailoredCv}
          drafts={drafts}
          recipients={recipients}
          locale={locale}
          target={{ title: application.jobOffer.title, ...(application.jobOffer.employer && { employer: application.jobOffer.employer }) }}
          {...(result ? { only: result } : {})}
        />
      );
    }
    case "correspondance":
      return <MatchScoreView matchScore={application.matchScore} profileName={application.profile.name} t={t} locale={locale} />;
    case "entretiens":
      return <Interviews data={data} />;
    case "avis":
      return <CoachReviewList reviews={data.coachReviews} />;
    case "dossier":
      return <CompanyDossierView applicationId={application.id} state={data.companyDossier} t={t} locale={locale} />;
    case "contacts":
      return data.enrichedContacts ? (
        <EnrichedContactsPanel
          key={`enriched-contacts-${application.id}`}
          applicationId={application.id}
          initial={data.enrichedContacts}
          hasDossier={data.companyDossier?.status === "built"}
          locale={locale}
        />
      ) : null;
    case "offre":
      // Its facts and its Job Offer Summary come first, then its full text (#603).
      return (
        <>
          <JobOfferTiles jobOffer={application.jobOffer} t={t} locale={locale} />
          <JobOfferSummary applicationId={application.id} summary={application.jobOffer.summary} needsReading={!application.jobOffer.summary || !application.jobOffer.sector} />
          <JobOfferView jobOffer={application.jobOffer} t={t} locale={locale} details={false} />
        </>
      );
  }
}

/**
 * The Application's Interviews: each one changed, cancelled or removed in place, and a form
 * to add one while it is at the interview stage. A Cancelled Interview stays, struck through,
 * with its date of cancellation; a Rescheduled one says when it was first planned, with its
 * history. A link leads to the Agenda: its past Agenda Items when all the Interviews here are past.
 */
function Interviews({ data: { application, t, locale, agendaHref } }: { data: ApplicationPageData }) {
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const changedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const cancelledOn = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const { interviews } = application;
  return (
    <section aria-labelledby="interviews-title">
      <div className="application-section-head">
        <h2 id="interviews-title">{t("application.interviewsTitle")}</h2>
        <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={agendaHref}>
          {t("application.seeInAgenda")}
        </Link>
      </div>
      {interviews.length > 0 ? (
        <ul className="application-interviews">
          {interviews.map((interview) => {
            const when = dateTime.format(interview.scheduledAt);
            return (
              <li key={interview.id} className="application-interview" data-cancelled={interview.cancelledAt ? true : undefined}>
                <p className="application-interview__date">
                  {date.format(interview.scheduledAt)}, <InterviewTimes interview={interview} time={time} />
                </p>
                {interview.cancelledAt ? (
                  <p>
                    <Pill tone="danger">{t("agendaChanges.cancelledOn", { date: cancelledOn.format(interview.cancelledAt) })}</Pill>
                  </p>
                ) : null}
                <InterviewFacts interview={interview} t={t} />
                {interview.note ? <p>{interview.note}</p> : null}
                <RescheduleHistory reschedules={interview.reschedules} dateTime={changedAt} t={t} />
                <div className="application-interview__actions">
                  <EditInterview
                    applicationId={application.id}
                    interview={{
                      id: interview.id,
                      scheduledAt: interviewWallClock(interview.scheduledAt),
                      durationMinutes: interview.durationMinutes === null ? "" : String(interview.durationMinutes),
                      format: interview.format ?? "",
                      place: interview.place,
                      note: interview.note,
                    }}
                    label={t("application.editInterview", { date: when })}
                  />
                  {interview.cancelledAt ? null : (
                    <CancelAgendaItemButton
                      url={`/api/applications/${application.id}/interviews/${interview.id}/cancel`}
                      label={t("agendaChanges.cancelInterview")}
                      name={t("agendaChanges.cancelInterviewFor", { date: when })}
                      question={t("agendaChanges.cancelInterviewConfirm")}
                    />
                  )}
                  <RemoveInterviewButton applicationId={application.id} interviewId={interview.id} label={t("application.removeInterview", { date: when })} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={t("application.interviewsNone")} headingLevel={3} help={<EmptyStateHelp of="agenda" />}>
          {application.status === "interview" ? undefined : t("application.interviewsHint")}
        </EmptyState>
      )}
      {interviews.length > 0 ? <p className="application-hint">{t("agendaChanges.removeHint")}</p> : null}
      {application.status === "interview" ? (
        <AddInterviewForm applicationId={application.id} />
      ) : interviews.length > 0 ? (
        <p className="application-hint">{t("application.interviewsHint")}</p>
      ) : null}
    </section>
  );
}
