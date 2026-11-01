import Link from "next/link";
import type { ReactNode } from "react";
import type { ActivityElement } from "@/ai-activity/pane";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { ApplicationProfileSelect, ApplicationStatusSelect, ReportUnavailableButton } from "@/components/ApplicationControls";
import type { FicheContent, FicheLink } from "@/components/Fiche";
import { ObjectConversation } from "@/components/ObjectConversation";
import { ExpiredJobOfferNotice, jobOfferSite } from "@/components/JobOfferView";
import { matchScoreFigure, matchScoreInWords } from "@/components/job-search-words";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { FOLLOW_UP_CARD } from "@/follow-ups";
import { routes, type ApplicationResult, type ApplicationSection } from "@/routes";
import type { ApplicationPageData } from "./sections";

const MATCH_SCORE: ApplicationSection = "correspondance";
const SUGGESTIONS = ["prepareInterview", "followUp", "coverLetter", "matchScore"] as const;
/** The Subject of an Application's conversation (ADR-0070). */
const APPLICATION = "application";

/**
 * An Application's page under « Conversation au centre » (#603, ADR-0070): its Coach Conversation, whose Subject it is,
 * with the Introduction and the Application's suggestions until its first message; and the Fiche beside it, the
 * Application's card (status and Profile changed in place, Match Score, when it was saved, its Job Offer's site, whether
 * the offer is expired or Reported Unavailable), its Sections and its Results, each opened in the Work Pane at its own
 * address (`children`, the Section or Result the address names: see sections.tsx).
 */
export function ApplicationConversation({ data, aiActivity, children }: { data: ApplicationPageData; aiActivity: readonly ActivityElement[]; children: ReactNode }) {
  const { candidateId, application, t, inView } = data;
  return (
    <ObjectConversation
      candidateId={candidateId}
      subject={{ kind: APPLICATION, id: application.id }}
      inView={inView}
      title={application.jobOffer.title}
      aiActivity={aiActivity}
      fiche={ficheOf(data)}
      introduction={<p>{t("application.conversation.introduction", { title: application.jobOffer.title })}</p>}
      suggestions={SUGGESTIONS.map((suggestion) => ({
        label: t(`application.conversation.suggestions.${suggestion}.label`),
        message: t(`application.conversation.suggestions.${suggestion}.message`),
      }))}
    >
      {children}
    </ObjectConversation>
  );
}

/** The Application's Fiche: its card, its Sections in order, and its Results. */
function ficheOf(data: ApplicationPageData): FicheContent {
  const { application, t } = data;
  return {
    card: <ApplicationCard data={data} />,
    sections: data.sections.map((section) => ({ href: routes.applicationSection(application.id, section), label: t(`application.sections.${section}`) })),
    results: resultsOf(data),
  };
}

/**
 * What AI actions made for the Application and kept with it: its Tailored CV, Cover Letter and Outreach Message, each
 * alone at its address, then the Follow-up drafts the AI Coach suggests, in Propositions.
 */
function resultsOf({ application, t, locale, tailoredCv, drafts, shownCards }: ApplicationPageData): FicheLink[] {
  const date = (at: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE }).format(new Date(at));
  const drafted = (draft: { draftedAt?: string | Date } | null | undefined) => (draft?.draftedAt ? t("application.results.draftedOn", { date: date(draft.draftedAt) }) : t("application.results.draft"));
  const result = (kind: ApplicationResult, label: string, detail: string): FicheLink => ({ href: routes.applicationResult(application.id, kind), label, detail });
  return [
    ...(tailoredCv ? [result("tailored_cv", t("tailoredCv.tailored"), tailoredCv.saved ? t("application.results.savedOn", { date: date(tailoredCv.saved.savedAt) }) : t("application.results.toReview"))] : []),
    ...(drafts?.coverLetter ? [result("cover_letter", t("tailoredDocuments.coverLetter.title"), drafted(drafts.coverLetter))] : []),
    ...(drafts?.outreachMessage ? [result("outreach_message", t("tailoredDocuments.outreachMessage.title"), drafted(drafts.outreachMessage))] : []),
    ...shownCards
      .filter((card) => card.kind === FOLLOW_UP_CARD)
      .map((card) => ({ href: routes.applicationSection(application.id, "propositions"), label: t("followUps.cardLabel"), detail: card.title })),
  ];
}

/** The Application at a glance, first in its Fiche: what the page's header showed, its properties changed in place. */
function ApplicationCard({ data }: { data: ApplicationPageData }) {
  const { application, t, locale, profiles } = data;
  const { jobOffer } = application;
  const site = jobOfferSite(jobOffer);
  // Active Profiles to pick from, and the one in use even if it was archived since.
  const choices = profiles.filter((profile) => !profile.archived || profile.id === application.profile.id).map(({ id, name }) => ({ id, name }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const facts = [jobOffer.employer, jobOffer.location].filter(Boolean).join(" · ");
  return (
    <div className="application-card">
      {facts ? <p className="application-card__facts">{facts}</p> : null}
      <dl className="props">
        <ApplicationStatusSelect applicationId={application.id} status={application.status} property />
        <ApplicationProfileSelect applicationId={application.id} profileId={application.profile.id} profiles={choices} />
        <div className="prop">
          <dt>{t("application.matchLabel")}</dt>
          <dd>
            <span className="score">{matchScoreInWords(matchScoreFigure(application.matchScore), t)}</span>{" "}
            <Link href={routes.applicationSection(application.id, MATCH_SCORE)} scroll={false}>
              {t("application.matchDetail")}
            </Link>
          </dd>
        </div>
        <div className="prop">
          <dt>{t("application.savedOnLabel")}</dt>
          <dd>{date.format(application.createdAt)}</dd>
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
      <ExpiredJobOfferNotice jobOffer={jobOffer} t={t} locale={locale}>
        {t("application.expiredNotice")}
      </ExpiredJobOfferNotice>
      {application.reportedUnavailableAt ? (
        <Note tone="warn" role="status">
          <p className="application-flags">
            <Pill tone="danger">{t("applications.expired")}</Pill>
            <Pill>{t("applications.reportedByYou")}</Pill>
          </p>
          <p>{t("application.reportedNotice", { date: date.format(application.reportedUnavailableAt) })}</p>
        </Note>
      ) : null}
      {/* Reported Unavailable: for an offer not (yet) found expired, or to undo a report. */}
      {!jobOffer.expiredAt || application.reportedUnavailableAt ? <ReportUnavailableButton applicationId={application.id} reported={Boolean(application.reportedUnavailableAt)} /> : null}
    </div>
  );
}
