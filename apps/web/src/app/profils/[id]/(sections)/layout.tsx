import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Pill } from "@/design/Pill";
import { Ring } from "@/design/Ring";
import { ProfileTitle, SearchCriteriaProperties } from "@/components/ProfileInlineEdits";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { SectionsLayout } from "@/components/SectionsLayout";
import { getServerT } from "@/i18n/server";
import { readIndustryReference } from "@/reference-data/server";
import { routes, type ProfileSection } from "@/routes";
import { ArchivedCriteria, loadProfileAside, loadProfilePage } from "./profile-page";

type Params = { params: Promise<{ id: string }> };

/** The Sections the page's head and aside lead to. */
const DOWNLOAD: ProfileSection = "telecharger";
const ATS_SCORE: ProfileSection = "ats-score";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await loadProfilePage((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/**
 * One Profile, as a document (prototype #132), split into Sections (ADR-0024), in the Design System (#468): its
 * eyebrow, status and actions (« Chercher des offres », « Télécharger ») and its Search Criteria's card head the page,
 * its Sections are tabs, and its ATS Score stays in a card beside every Section.
 * its name as the title (in the Top Bar) and its Search Criteria as properties,
 * both edited in place and saved on change (read-only while archived), head
 * every Section; then the AI Coach's Action Cards about it (ATS Fixes among
 * them, Senior Advice labelled), its Master CV, edited in place and saved as a
 * new version (ADR-0012), its ATS Score, its CV export, and
 * what can be done with it, each a page of its own under /profils/<id>.
 * Its Job Searches start from Recherches d'offres and the Coach Panel, its
 * Job Digest is on the Job Digests page: neither is offered here (#238).
 * Under « Conversation au centre » (#605, ADR-0070), the page is the Profile's conversation instead (../layout.tsx), each
 * Section opening in the Work Pane beside it.
 */
export default async function ProfileSectionsLayout({ params, children }: Params & { children: ReactNode }) {
  if (pagesAreConversations()) return children;
  const id = (await params).id;
  const { candidateId, profile, inView, locale, sections } = await loadProfilePage(id);
  const [{ atsScore, aiActivity }, t] = await Promise.all([loadProfileAside(id), getServerT()]);
  const criteria = profile.searchCriteria;
  // An archived Profile's Sectors and Domains are read by their labels (#236); an active one's inputs fetch them.
  const industries = profile.archived ? await readIndustryReference() : null;
  return (
    <CandidateLayout
      candidateId={candidateId}
      currentProfileId={profile.id}
      aiActivity={aiActivity}
      title={<ProfileTitle key={`title-${profile.id}`} profileId={profile.id} name={profile.name} />}
    >
      <article className="document profile-page">
        <header className="page-head profile-head">
          <div className="profile-head-row">
            <p className="eyebrow">{t("profilePage.eyebrow")}</p>
            <Pill tone={profile.archived ? "neutral" : "success"}>{t(profile.archived ? "profilePage.status.archived" : "profilePage.status.active")}</Pill>
            <div className="profile-head-actions">
              {profile.archived ? null : (
                <Link className={buttonClass({ size: "sm" })} href={routes.jobSearches(profile.id)}>
                  <Icons.jobSearches />
                  {t("profilePage.actions.searchOffers")}
                </Link>
              )}
              <Link className={buttonClass({ size: "sm" })} href={routes.profileSection(profile.id, DOWNLOAD)}>
                <Icons.download />
                {t("profilePage.actions.download")}
              </Link>
            </div>
          </div>
          {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
          <Card title={t("cvReview.searchCriteria")}>
            {profile.archived ? (
              <ArchivedCriteria criteria={criteria} locale={locale} t={t} industries={industries ?? { sectors: [], subsectors: [], domains: [] }} />
            ) : (
              <SearchCriteriaProperties key={`criteria-${profile.id}`} profileId={profile.id} searchCriteria={criteria} />
            )}
          </Card>
        </header>

        <CoachInView {...inView} />
        <SectionsLayout
          base={routes.profile(profile.id)}
          label={t("profilePage.sections.sectionsLabel")}
          backLabel={t("profilePage.sections.backToSections")}
          sections={sections.map((section) => ({ href: routes.profileSection(profile.id, section), label: t(`profilePage.sections.${section}`) }))}
          look="tabs"
          aside={
            <Card title={t("atsScore.title")}>
                <div className="profile-ats">
                  {atsScore ? <Ring label={t("atsScore.title")} value={atsScore.score.score} /> : null}
                  <p className="profile-ats-text">{t(atsScore ? "profilePage.ats.computed" : "profilePage.ats.none")}</p>
                </div>
                <Link href={routes.profileSection(profile.id, ATS_SCORE)}>{t(atsScore ? "profilePage.ats.open" : "profilePage.ats.compute")}</Link>
            </Card>
          }
        >
          {children}
        </SectionsLayout>
      </article>
    </CandidateLayout>
  );
}
