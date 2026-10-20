import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { ProfileTitle, SearchCriteriaProperties } from "@/components/ProfileInlineEdits";
import { SectionsLayout } from "@/components/SectionsLayout";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { ArchivedCriteria, loadProfilePage } from "./profile-page";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await loadProfilePage((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/**
 * One Profile, as a document (prototype #132), split into Sections (ADR-0024):
 * its name as the title (in the Top Bar) and its Search Criteria as properties,
 * both edited in place and saved on change (read-only while archived), head
 * every Section; then the AI Coach's Action Cards about it (ATS Fixes among
 * them, Senior Advice labelled), its Master CV, edited in place and saved as a
 * new version (ADR-0012), its ATS Score, its CV export, and
 * what can be done with it, each a page of its own under /profils/<id>.
 */
export default async function ProfileLayout({ params, children }: Params & { children: ReactNode }) {
  const { candidateId, profile, inView, jobDigest, locale, sections } = await loadProfilePage((await params).id);
  const t = await getServerT();
  const criteria = profile.searchCriteria;
  return (
    <CandidateLayout
      candidateId={candidateId}
      currentProfileId={profile.id}
      title={<ProfileTitle key={`title-${profile.id}`} profileId={profile.id} name={profile.name} />}
    >
      <article className="document">
        <header className="page-head">
          <p className="eyebrow">{t("profilePage.eyebrow")}</p>
          {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
          {profile.archived ? (
            <ArchivedCriteria criteria={criteria} locale={locale} t={t} />
          ) : (
            <SearchCriteriaProperties key={`criteria-${profile.id}`} profileId={profile.id} searchCriteria={criteria} />
          )}
          {profile.archived ? null : (
            // The Job Search and the Job Digest of this Profile, a click away.
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
        <SectionsLayout
          base={routes.profile(profile.id)}
          label={t("profilePage.sections.sectionsLabel")}
          backLabel={t("profilePage.sections.backToSections")}
          sections={sections.map((section) => ({ href: routes.profileSection(profile.id, section), label: t(`profilePage.sections.${section}`) }))}
        >
          {children}
        </SectionsLayout>
      </article>
    </CandidateLayout>
  );
}
