import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { ApplicationProfileSelect, ApplicationStatusSelect, ReportUnavailableButton } from "@/components/ApplicationControls";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferSummary } from "@/components/JobOfferSummary";
import { ExpiredJobOfferNotice, JobOfferTiles, jobOfferSite } from "@/components/JobOfferView";
import { matchScoreFigure, matchScoreInWords } from "@/components/job-search-words";
import { SectionsLayout } from "@/components/SectionsLayout";
import { routes, type ApplicationSection } from "@/routes";
import { loadApplicationPage, type Params } from "./sections";

const MATCH_SCORE: ApplicationSection = "correspondance";

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
 */
export default async function ApplicationLayout({ params, children }: Params & { children: ReactNode }) {
  const { candidateId, application, t, locale, inView, profiles, sections } = await loadApplicationPage((await params).id);
  // Active Profiles to pick from, and the one in use even if it was archived since.
  const choices = profiles.filter((profile) => !profile.archived || profile.id === application.profile.id).map(({ id, name }) => ({ id, name }));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const { jobOffer } = application;
  const site = jobOfferSite(jobOffer);
  return (
    <CandidateLayout candidateId={candidateId} title={jobOffer.title}>
      <div className="doc">
        <header className="page-head">
          <p className="eyebrow">
            <Link href={routes.applications}>{t("application.backToApplications")}</Link>
          </p>
          <JobOfferTiles jobOffer={jobOffer} t={t} locale={locale} />
          <JobOfferSummary applicationId={application.id} summary={jobOffer.summary} needsReading={!jobOffer.summary || !jobOffer.sector} />
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

        <SectionsLayout
          base={routes.application(application.id)}
          label={t("application.sections.sectionsLabel")}
          backLabel={t("application.sections.backToSections")}
          sections={sections.map((section) => ({ href: routes.applicationSection(application.id, section), label: t(`application.sections.${section}`) }))}
        >
          {children}
        </SectionsLayout>
      </div>
    </CandidateLayout>
  );
}
