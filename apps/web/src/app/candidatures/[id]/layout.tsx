import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { tailoredDocumentsMade, type Made } from "@/ai-activity";
import { loadAiActivity } from "@/ai-activity/server";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { dossierSites } from "@/company-dossiers";
import { ABANDON_CARD } from "@/follow-ups";
import { ApplicationProfileSelect, ApplicationStatusSelect, ReportUnavailableButton } from "@/components/ApplicationControls";
import { CandidateLayout } from "@/components/CandidateLayout";
import { conversationFirst } from "@/conversation-first";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferSummary } from "@/components/JobOfferSummary";
import { ExpiredJobOfferNotice, JobOfferTiles, jobOfferSite } from "@/components/JobOfferView";
import { matchScoreFigure, matchScoreInWords } from "@/components/job-search-words";
import { SectionsLayout } from "@/components/SectionsLayout";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { routes, type ApplicationSection } from "@/routes";
import "./application.css";
import { ApplicationConversation } from "./conversation";
import { loadApplicationPage, type Params } from "./sections";

const MATCH_SCORE: ApplicationSection = "correspondance";
/** Its Sections as tabs from 64rem (#467). */
const SECTIONS_LOOK = "tabs";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { application, t } = await loadApplicationPage((await params).id);
  return { title: `${application.jobOffer.title} · ${t("app.name")}` };
}

/**
 * One Application, laid out as a document (the Notion-like prototype, #132): on
 * every Section, the Job Offer at a glance (its facts framed, skills as tags), then
 * the Job Offer Summary (written by the AI, asked for once the page is shown when
 * the offer has none yet), then the Application's properties
 * (status and Profile, both changed in place; Match Score; when it was saved;
 * the Job Offer's site), then whether its Job Offer is expired or Reported
 * Unavailable by the Candidate (who can report it, and undo that). Then its
 * Sections (ADR-0024), each at its own address: the AI Coach's Action Cards, the
 * Tailored Documents in tabs, the Match Score's breakdown, the Interviews, the
 * Human Coaches' Coach Reviews, the Company Dossier, its Enriched Contacts (when
 * a contact-data provider is on) and the full Job Offer.
 * Under « Conversation au centre » (#603, ADR-0070), the page is the Application's conversation instead, with its Fiche
 * (see ApplicationConversation).
 */
export default async function ApplicationLayout({ params, children }: Params & { children: ReactNode }) {
  const data = await loadApplicationPage((await params).id);
  const { candidateId, application, t, locale, inView, profiles, sections, shownCards, companyDossier, tailoredCv, drafts } = data;
  // What AI made for the Application: the Tailored CV and Documents (#334), the Action Cards (#336) and the Company Dossier
  // (#335; one built before shows « modèle non enregistré » with the sites its source names) with their Provenance. An
  // « Abandonnée » suggestion is worded by Jobbbox, no AI: not listed.
  const made: Made[] = [
    ...tailoredDocumentsMade(tailoredCv, drafts),
    ...(companyDossier?.status === "built"
      ? [
          {
            kind: "company_dossier" as const,
            at: companyDossier.dossier.builtAt,
            provenance: companyDossier.provenance ?? null,
            ...(companyDossier.provenance ? {} : { sites: dossierSites(companyDossier.dossier) }),
          },
        ]
      : []),
    ...shownCards
      .filter((card) => card.kind !== ABANDON_CARD)
      .map((card) => ({ kind: "action_card" as const, name: card.title, at: card.createdAt, provenance: card.provenance })),
  ];
  const aiActivity = await loadAiActivity.application(candidateId, { id: application.id, jobOffer: { id: application.jobOffer.id, title: application.jobOffer.title } }, made);
  if (conversationFirst(getPlatformSettingsResolver().current()))
    return (
      <ApplicationConversation data={data} aiActivity={aiActivity}>
        {children}
      </ApplicationConversation>
    );
  // Active Profiles to pick from, and the one in use even if it was archived since.
  const choices = profiles.filter((profile) => !profile.archived || profile.id === application.profile.id).map(({ id, name }) => ({ id, name }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const { jobOffer } = application;
  const site = jobOfferSite(jobOffer);
  return (
    <CandidateLayout candidateId={candidateId} title={jobOffer.title} aiActivity={aiActivity}>
      <div className="application-page">
        <header className="application-head">
          <p className="application-head__back">
            <Link href={routes.applications}>{t("application.backToApplications")}</Link>
          </p>
          <JobOfferTiles jobOffer={jobOffer} t={t} locale={locale} />
          <JobOfferSummary applicationId={application.id} summary={jobOffer.summary} needsReading={!jobOffer.summary || !jobOffer.sector} />
          <div className="application-head__props">
            <dl className="props">
              <ApplicationStatusSelect applicationId={application.id} status={application.status} property />
              <ApplicationProfileSelect applicationId={application.id} profileId={application.profile.id} profiles={choices} />
              <div className="prop">
                <dt>{t("application.matchLabel")}</dt>
                <dd>
                  <span className="score">{matchScoreInWords(matchScoreFigure(application.matchScore), t)}</span>
                  <Link href={routes.applicationSection(application.id, MATCH_SCORE)}>{t("application.matchDetail")}</Link>
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
          </div>
        </header>

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
        {!jobOffer.expiredAt || application.reportedUnavailableAt ? (
          <ReportUnavailableButton applicationId={application.id} reported={Boolean(application.reportedUnavailableAt)} />
        ) : null}
        <CoachInView {...inView} />

        <SectionsLayout
          base={routes.application(application.id)}
          label={t("application.sections.sectionsLabel")}
          backLabel={t("application.sections.backToSections")}
          sections={sections.map((section) => ({ href: routes.applicationSection(application.id, section), label: t(`application.sections.${section}`) }))}
          look={SECTIONS_LOOK}
        >
          {children}
        </SectionsLayout>
      </div>
    </CandidateLayout>
  );
}
