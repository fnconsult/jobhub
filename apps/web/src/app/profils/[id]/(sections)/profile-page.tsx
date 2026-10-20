import type { SearchCriteria } from "@jobhub/shared";
import { notFound, redirect } from "next/navigation";
import { Fragment, cache } from "react";
import { getActionCards } from "@/action-cards/server";
import { atsFixOf } from "@/ats-score";
import { getAtsScoring } from "@/ats-score/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AtsScoreView } from "@/components/AtsScoreView";
import { CvExportForm } from "@/components/CvExportForm";
import { anyOfInWords, contractTypesInWords, remoteWorkOptionsInWords } from "@/components/job-search-words";
import { MasterCvDocument } from "@/components/MasterCvDocument";
import { ProfileActions } from "@/components/ProfileActions";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobDigests } from "@/job-digests/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { PROFILE_SECTIONS, type ProfileSection, routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * What every Section of a Profile's page needs, loaded once per request (the
 * layout and the Section shown share it): the Profile, its Action Cards and
 * the Sections it has, and its Job Digest for the header's link to it on the
 * Job Digests page. Propositions is there only while the AI Coach has Action
 * Cards about it.
 */
export const loadProfilePage = cache(async (id: string) => {
  const { candidateId, profile } = await requireOwnProfile(id);
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const [cards, jobDigest, locale] = await Promise.all([
    getActionCards().pending(candidateId, inView),
    getJobDigests().settings(candidateId, profile.id),
    getRequestLocale(),
  ]);
  const sections = PROFILE_SECTIONS.filter((section) => {
    if (section === "propositions") return cards.length > 0;
    return true;
  });
  return { candidateId, profile, inView, cards, jobDigest, locale, sections };
});

/**
 * One Section of a Profile's page. A Section the Profile does not have is not
 * found, but for Propositions: its last Action Card decided (an accepted one
 * refreshes the page), the Candidate is taken back to the Profile's page.
 */
export async function ProfileSectionPage({ id, section }: { id: string; section: ProfileSection }) {
  const page = await loadProfilePage(id);
  if (!page.sections.includes(section)) {
    if (section === "propositions") redirect(routes.profile(page.profile.id));
    notFound();
  }
  const t = await getServerT();
  switch (section) {
    case "propositions":
      return <Propositions page={page} t={t} />;
    case "cv-de-reference":
      return <MasterCv page={page} />;
    case "ats-score":
      return <AtsScore page={page} t={t} />;
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

/** An archived Profile's Search Criteria: read-only until it is restored. */
export function ArchivedCriteria({ criteria, locale, t }: { criteria: SearchCriteria; locale: string; t: T }) {
  const notSpecified = t("profile.notSpecified");
  const properties: [string, string][] = [
    [t("cvReview.targetRole"), criteria.targetRole],
    [t("cvReview.locations"), anyOfInWords(criteria.locations, locale)],
    [
      t("cvReview.minSalary"),
      criteria.minSalary === undefined ? notSpecified : t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) }),
    ],
    [t("cvReview.contractType"), contractTypesInWords(criteria.contractTypes, t, locale) || notSpecified],
    [t("cvReview.remoteWork"), remoteWorkOptionsInWords(criteria.remoteWorkOptions, t, locale) || notSpecified],
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
