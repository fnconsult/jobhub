import type { SearchCriteria } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { getActionCards } from "@/action-cards/server";
import { atsFixOf } from "@/ats-score";
import { getAtsScoring } from "@/ats-score/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AtsScoreView } from "@/components/AtsScoreView";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { CvExportForm } from "@/components/CvExportForm";
import { JobDigestControls } from "@/components/JobDigestControls";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { MasterCvDocument } from "@/components/MasterCvDocument";
import { ProfileActions } from "@/components/ProfileActions";
import { ProfileTitle, SearchCriteriaProperties } from "@/components/ProfileInlineEdits";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobDigests } from "@/job-digests/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

async function currentProfile(id: string) {
  return requireOwnProfile(id);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await currentProfile((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/**
 * One Profile, as a document (prototype #132): its name as the title and its
 * Search Criteria as properties, both edited in place and saved on change
 * (read-only while archived); the AI Coach's Action Cards about it (ATS Fixes
 * among them, Senior Advice labelled); its Master CV, edited in place and saved
 * as a new version (ADR-0012); its ATS Score, its Job Digest, its CV export, and
 * what can be done with it.
 */
export default async function ProfilePage({ params }: Params) {
  const { candidateId, profile } = await currentProfile((await params).id);
  const t = await getServerT();
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const [cards, atsScore, jobDigest, versions, locale] = await Promise.all([
    getActionCards().pending(candidateId, inView),
    getAtsScoring().latest(candidateId, profile.id),
    getJobDigests().settings(candidateId, profile.id),
    getProfiles().masterCvVersions(candidateId, profile.id),
    getRequestLocale(),
  ]);
  const { searchCriteria: criteria, masterCv } = profile;
  const savedAt = versions?.find((each) => each.version === masterCv.version)?.savedAt;
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id}>
      <article className="document">
        <header className="page-head">
          <p className="eyebrow">{t("profilePage.eyebrow")}</p>
          <ProfileTitle key={`title-${profile.id}`} profileId={profile.id} name={profile.name} />
          {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
          {profile.archived ? (
            <ArchivedCriteria criteria={criteria} locale={locale} t={t} />
          ) : (
            <SearchCriteriaProperties key={`criteria-${profile.id}`} profileId={profile.id} searchCriteria={criteria} />
          )}
          {profile.archived ? null : (
            // The sidebar's Job Searches link leads here (routes.profileJobSearch).
            <div className="btn-row" id="job-search-title" aria-label={t("jobSearch.sectionTitle")} role="group">
              <StartJobSearchButton key={profile.id} profileId={profile.id} />
              {jobDigest ? (
                <Link className="button" href={routes.profileJobDigest(profile.id)}>
                  {t(`profilePage.jobDigestLink.${jobDigest.subscribed ? jobDigest.frequency : "none"}`)}
                </Link>
              ) : null}
            </div>
          )}
        </header>

        <CoachInView {...inView} />
        <ActionCardList
          key={`action-cards-${profile.id}`}
          cards={cards.map(({ id, title, body, kind, payload }): ActionCardView => {
            const seniorAdvice = atsFixOf({ kind, payload })?.category === "senior_advice";
            return seniorAdvice ? { id, title, body, label: t("atsFixes.seniorAdvice"), dismissLabel: t("atsFixes.dismissAdvice") } : { id, title, body };
          })}
        />

        <MasterCvDocument
          key={`master-cv-${profile.id}`}
          profileId={profile.id}
          version={masterCv.version}
          savedOn={savedAt ? formatDate(savedAt, locale) : null}
          content={masterCv.content}
        />

        <AtsScoreView profileId={profile.id} targetRole={criteria.targetRole} currentVersion={masterCv.version} atsScore={atsScore} t={t} />

        {jobDigest && !profile.archived ? (
          <section className="section" aria-labelledby="job-digest-title">
            <div className="section-head">
              <h2 id="job-digest-title">{t("jobDigest.sectionTitle")}</h2>
            </div>
            <p>{t("jobDigest.hint")}</p>
            {jobDigest.planFrequency !== "none" ? <p>{t(`jobDigest.frequency.${jobDigest.planFrequency}`)}</p> : null}
            {jobDigest.subscribed ? (
              <>
                <p className="notice" role="status">
                  {t("jobDigest.subscribed")}
                </p>
                {jobDigest.frequency !== "none" ? <p>{t(`jobDigest.schedule.${jobDigest.frequency}`)}</p> : null}
                {jobDigest.chosenFrequency !== jobDigest.frequency ? <p>{t("jobDigest.cappedToPlan")}</p> : null}
              </>
            ) : null}
            <JobDigestControls
              key={profile.id}
              profileId={profile.id}
              subscribed={jobDigest.subscribed}
              chosenFrequency={jobDigest.chosenFrequency}
              planFrequency={jobDigest.planFrequency}
            />
            {jobDigest.digests.length > 0 ? (
              <>
                <h3>{t("jobDigest.latestTitle")}</h3>
                <ul className="rows">
                  {jobDigest.digests.map((digest) => (
                    <li key={digest.id} className="row">
                      <Link className="row-title" href={routes.jobDigest(digest.id)}>
                        {t("jobDigest.digestLink", { date: formatDate(digest.sentAt, locale), count: digest.count })}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        <CvExportForm profileId={profile.id} t={t} />

        <ProfileActions key={`${profile.id}-${profile.name}`} profile={{ id: profile.id, name: profile.name, archived: profile.archived }} />
      </article>
    </CandidateLayout>
  );
}

/** An archived Profile's Search Criteria: read-only until it is restored. */
function ArchivedCriteria({ criteria, locale, t }: { criteria: SearchCriteria; locale: string; t: Awaited<ReturnType<typeof getServerT>> }) {
  const notSpecified = t("profile.notSpecified");
  const properties: [string, string][] = [
    [t("cvReview.targetRole"), criteria.targetRole],
    [t("cvReview.location"), criteria.location],
    [
      t("cvReview.minSalary"),
      criteria.minSalary === undefined ? notSpecified : t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) }),
    ],
    [t("cvReview.contractType"), criteria.contractType ? t(`cvReview.contractTypes.${criteria.contractType}`) : notSpecified],
    [t("cvReview.remoteWork"), criteria.remoteWork ? t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) : notSpecified],
  ];
  return (
    <dl className="props" aria-label={t("cvReview.searchCriteria")}>
      {properties.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "Europe/Paris" }).format(date);
}
