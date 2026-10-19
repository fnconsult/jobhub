import { notFound } from "next/navigation";
import { cache } from "react";
import type { ActionCard } from "@/action-cards";
import { getActionCards } from "@/action-cards/server";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { requireOwnApplication } from "@/applications/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AddInterviewForm, EditInterview, RemoveInterviewButton } from "@/components/ApplicationControls";
import { CoachReviewList } from "@/components/CoachReviewList";
import { CompanyDossierView } from "@/components/CompanyDossierView";
import { EnrichedContactsPanel } from "@/components/EnrichedContactsPanel";
import { JobOfferView } from "@/components/JobOfferView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { TailoredDocuments } from "@/components/TailoredDocuments";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { ABANDON_CARD, FOLLOW_UP_CARD, followUpCardApplies, type FollowUpPayload } from "@/follow-ups";
import { getHumanCoaches } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { APPLICATION_SECTIONS, type ApplicationSection } from "@/routes";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";

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
  const cards = pendingCards.filter((card) => followUpCardApplies(card, application.status)).map((card) => cardView(card, t));
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
  return { candidateId, application, t, locale, inView, cards, profiles, companyDossier, enrichedContacts, tailoredCv, drafts, coachReviews, sections };
});

/** Always there, as is the Job Offer. */
const MATCH_SCORE: ApplicationSection = "correspondance";

type ApplicationPageData = Awaited<ReturnType<typeof loadApplicationPage>>;

/**
 * One Section of an Application's page, at its own address. A Section there
 * is not (no Tailored Documents yet, say) answers 404, except Propositions: its
 * last Action Card accepted refreshes the page, which keeps saying it was.
 */
export async function ApplicationSectionPage({ params, section }: Params & { section: ApplicationSection }) {
  const data = await loadApplicationPage((await params).id);
  if (section !== "propositions" && !data.sections.includes(section)) notFound();
  return <SectionView data={data} section={section} />;
}

/**
 * The address of the page itself: its first Section (below 64rem, CSS shows the
 * list of Sections there instead). The Action Cards stay in place when there are
 * none, so that accepting the last one, which refreshes the page, still says so
 * above the Section that now comes first.
 */
export async function ApplicationFirstSectionPage({ params }: Params) {
  const data = await loadApplicationPage((await params).id);
  const first = data.sections.find((section) => section !== "propositions") ?? MATCH_SCORE;
  return (
    <>
      <ActionCardList key={data.application.id} cards={data.cards} />
      {data.cards.length === 0 ? <SectionView data={data} section={first} /> : null}
    </>
  );
}

function SectionView({ data, section }: { data: ApplicationPageData; section: ApplicationSection }) {
  const { application, t, locale } = data;
  switch (section) {
    case "propositions":
      return <ActionCardList key={application.id} cards={data.cards} />;
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
      return <JobOfferView jobOffer={application.jobOffer} t={t} locale={locale} />;
  }
}

/** The Application's Interviews: each one changed or removed in place, and a form to add one while it is at the interview stage. */
function Interviews({ data: { application, t, locale } }: { data: ApplicationPageData }) {
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const { interviews } = application;
  return (
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
  );
}
