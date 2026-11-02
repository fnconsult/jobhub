import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Made } from "@/ai-activity";
import { loadAiActivity } from "@/ai-activity/server";
import { getActionCards } from "@/action-cards/server";
import { atsFixOf } from "@/ats-score";
import { getAtsScoring } from "@/ats-score/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AtsScoreView } from "@/components/AtsScoreView";
import { CvExportForm } from "@/components/CvExportForm";
import { MasterCvDocument } from "@/components/MasterCvDocument";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { ProfileActions } from "@/components/ProfileActions";
import { TargetCompanies } from "@/components/TargetCompanies";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { PROFILE_SECTIONS, type ProfileSection, routes } from "@/routes";
import { getTargetCompanies } from "@/target-companies/server";

/** What it is in the Work Pane. */
const SECTION: AddressedKind = "section";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * What every Section of a Profile's page needs, loaded once per request (the
 * layout and the Section shown share it): the Profile, its Action Cards and
 * the Sections it has. Propositions is there only while the AI Coach has
 * Action Cards about it.
 */
export const loadProfilePage = cache(async (id: string) => {
  const { candidateId, profile } = await requireOwnProfile(id);
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const [cards, locale] = await Promise.all([getActionCards().pending(candidateId, inView), getRequestLocale()]);
  const sections = PROFILE_SECTIONS.filter((section) => {
    if (section === "propositions") return cards.length > 0;
    return true;
  });
  return { candidateId, profile, inView, cards, locale, sections };
});

/**
 * What the head of a Profile's page, or its Fiche, shows beside its Sections, loaded once per request: its ATS Score, the
 * versions of its Master CV, and its AI Activity: the Master CV when the AI Coach read it from the Candidate's file
 * (#335), then the ATS Score and the Action Cards (ATS Fixes among them), each with what made it (#336).
 */
export const loadProfileAside = cache(async (id: string) => {
  const { candidateId, profile, cards } = await loadProfilePage(id);
  const [atsScore, versions] = await Promise.all([getAtsScoring().latest(candidateId, profile.id), getProfiles().masterCvVersions(candidateId, profile.id)]);
  const read = versions?.find((version) => version.provenance);
  const made: Made[] = [
    ...(read ? [{ kind: "master_cv" as const, at: read.savedAt, provenance: read.provenance }] : []),
    ...(atsScore ? [{ kind: "ats_score" as const, at: atsScore.computedAt, provenance: atsScore.provenance }] : []),
    ...cards.map((card) => ({ kind: "action_card" as const, name: card.title, at: card.createdAt, provenance: card.provenance })),
  ];
  const aiActivity = await loadAiActivity.profile(candidateId, { id: profile.id }, made);
  return { atsScore, versions: versions ?? [], aiActivity };
});

/**
 * One Section of a Profile's page. A Section the Profile does not have is not
 * found, but for Propositions: its last Action Card decided (an accepted one
 * refreshes the page), the Candidate is taken back to the Profile's page.
 * It opens in the Work Pane beside the Profile's conversation (#605, ADR-0070).
 */
export async function ProfileSectionPage({ id, section }: { id: string; section: ProfileSection }) {
  const page = await loadProfilePage(id);
  if (!page.sections.includes(section)) {
    if (section === "propositions") redirect(routes.profile(page.profile.id));
    notFound();
  }
  const t = await getServerT();
  return (
    <InWorkPane kind={SECTION} title={t(`profilePage.sections.${section}`)} href={routes.profileSection(page.profile.id, section)} back={routes.profile(page.profile.id)}>
      <SectionView page={page} section={section} t={t} />
    </InWorkPane>
  );
}

function SectionView({ page, section, t }: { page: Page; section: ProfileSection; t: T }) {
  switch (section) {
    case "propositions":
      return <Propositions page={page} t={t} />;
    case "cv-de-reference":
      return <MasterCv page={page} />;
    case "ats-score":
      return <AtsScore page={page} t={t} />;
    case "entreprises-cibles":
      return <TargetCompaniesSection page={page} />;
    case "telecharger":
      return <CvExportForm profileId={page.profile.id} t={t} />;
    case "gerer":
      return (
        <ProfileActions
          key={`${page.profile.id}-${page.profile.name}`}
          profile={{ id: page.profile.id, name: page.profile.name, archived: page.profile.archived }}
        />
      );
  }
}

/** The page of one Section, at /profils/<id>/<section>. */
export function profileSectionPage(section: ProfileSection) {
  return async function ProfileSectionRoute({ params }: { params: Promise<{ id: string }> }) {
    return <ProfileSectionPage id={(await params).id} section={section} />;
  };
}

type Page = Awaited<ReturnType<typeof loadProfilePage>>;

/** The AI Coach's Action Cards about the Profile, ATS Fixes among them (Senior Advice labelled). */
function Propositions({ page, t }: { page: Page; t: T }) {
  return (
    <ActionCardList
      key={`action-cards-${page.profile.id}`}
      cards={page.cards.map(({ id, title, body, kind, payload }): ActionCardView => {
        const seniorAdvice = atsFixOf({ kind, payload })?.category === "senior_advice";
        return seniorAdvice ? { id, title, body, label: t("atsFixes.seniorAdvice"), dismissLabel: t("atsFixes.dismissAdvice") } : { id, title, body };
      })}
    />
  );
}

/** The Master CV, edited in place and saved as a new version (ADR-0012). */
async function MasterCv({ page }: { page: Page }) {
  const { candidateId, profile, locale } = page;
  const versions = await getProfiles().masterCvVersions(candidateId, profile.id);
  const savedAt = versions?.find((each) => each.version === profile.masterCv.version)?.savedAt;
  return (
    <MasterCvDocument
      key={`master-cv-${profile.id}`}
      profileId={profile.id}
      version={profile.masterCv.version}
      savedOn={savedAt ? formatDate(savedAt, locale) : null}
      content={profile.masterCv.content}
    />
  );
}

/** The ATS Score; once computed, the fixes it proposes are in Propositions. */
async function AtsScore({ page, t }: { page: Page; t: T }) {
  const { candidateId, profile, sections } = page;
  const atsScore = await getAtsScoring().latest(candidateId, profile.id);
  const proposalsHref = sections.includes("propositions") ? routes.profileSection(profile.id, "propositions") : null;
  return (
    <AtsScoreView
      profileId={profile.id}
      targetRole={profile.searchCriteria.targetRole}
      currentVersion={profile.masterCv.version}
      atsScore={atsScore}
      proposalsHref={proposalsHref}
      t={t}
    />
  );
}

/** « Entreprises cibles » (#409): the Profile's Target Companies and what the Candidate can do there. */
async function TargetCompaniesSection({ page }: { page: Page }) {
  const { candidateId, profile } = page;
  const companies = (await getTargetCompanies().onProfile(candidateId, profile.id)) ?? [];
  return (
    <TargetCompanies
      key={`target-companies-${profile.id}`}
      profileId={profile.id}
      companies={companies.map((company) => ({
        id: company.id,
        name: company.name,
        own: company.origin === "candidate",
        city: company.city,
        activity: company.activity,
        headcount: company.headcount,
        hiringScore: company.hiringScore,
        jobOffers: company.jobOffers,
        spontaneousApplicationId: company.spontaneousApplicationId,
      }))}
    />
  );
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "Europe/Paris" }).format(date);
}
