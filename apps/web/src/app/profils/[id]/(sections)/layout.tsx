import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Made } from "@/ai-activity";
import { loadAiActivity } from "@/ai-activity/server";
import { getAtsScoring } from "@/ats-score/server";
import { getProfiles } from "@/profiles/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { ProfileTitle, SearchCriteriaProperties } from "@/components/ProfileInlineEdits";
import { SectionsLayout } from "@/components/SectionsLayout";
import { getServerT } from "@/i18n/server";
import { readIndustryReference } from "@/reference-data/server";
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
 * Its Job Searches start from Recherches d'offres and the Coach Panel, its
 * Job Digest is on the Job Digests page: neither is offered here (#238).
 */
export default async function ProfileLayout({ params, children }: Params & { children: ReactNode }) {
  const { candidateId, profile, inView, locale, sections, cards } = await loadProfilePage((await params).id);
  const [atsScore, versions] = await Promise.all([getAtsScoring().latest(candidateId, profile.id), getProfiles().masterCvVersions(candidateId, profile.id)]);
  // The Master CV, when the AI Coach read it from the Candidate's file (#335), then the ATS Score and the Action Cards
  // (ATS Fixes among them), each with what made it (#336).
  const read = versions?.find((version) => version.provenance);
  const made: Made[] = [
    ...(read ? [{ kind: "master_cv" as const, at: read.savedAt, provenance: read.provenance }] : []),
    ...(atsScore ? [{ kind: "ats_score" as const, at: atsScore.computedAt, provenance: atsScore.provenance }] : []),
    ...cards.map((card) => ({ kind: "action_card" as const, name: card.title, at: card.createdAt, provenance: card.provenance })),
  ];
  const [t, aiActivity] = await Promise.all([getServerT(), loadAiActivity.profile(candidateId, { id: profile.id }, made)]);
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
      <article className="document">
        <header className="page-head">
          <p className="eyebrow">{t("profilePage.eyebrow")}</p>
          {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
          {profile.archived ? (
            <ArchivedCriteria criteria={criteria} locale={locale} t={t} industries={industries ?? { sectors: [], subsectors: [], domains: [] }} />
          ) : (
            <SearchCriteriaProperties key={`criteria-${profile.id}`} profileId={profile.id} searchCriteria={criteria} />
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
