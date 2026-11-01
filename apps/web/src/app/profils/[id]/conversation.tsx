import Link from "next/link";
import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import { ObjectConversation } from "@/components/ObjectConversation";
import { ProfileTitle, SearchCriteriaProperties } from "@/components/ProfileInlineEdits";
import { buttonClass } from "@/design/button-class";
import { Pill } from "@/design/Pill";
import { Ring } from "@/design/Ring";
import { profileFicheLinks } from "@/fiches";
import { getServerT } from "@/i18n/server";
import { readIndustryReference } from "@/reference-data/server";
import { routes, type ProfileSection } from "@/routes";
import { ArchivedCriteria, loadProfileAside, loadProfilePage } from "./(sections)/profile-page";

type T = Awaited<ReturnType<typeof getServerT>>;

const ATS_SCORE: ProfileSection = "ats-score";
const SUGGESTIONS = ["improveCv", "atsScore", "criteria", "targetCompanies"] as const;
/** The Subject of a Profile's conversation (ADR-0070). */
const PROFILE = "profile";

/**
 * A Profile's page under « Conversation au centre » (#605, ADR-0070): its Coach Conversation, whose Subject it is, with
 * its Introduction and suggestions until its first message; and the Fiche beside it: the Profile's card (active or
 * archived, its Search Criteria changed in place, « Chercher des offres », its ATS Score), its Sections, and as Results
 * the versions of its Master CV and its CV export, each opened in the Work Pane at its own address (`children`). Its name,
 * in the Top Bar, is renamed in place.
 */
export async function ProfileConversation({ id, children }: { id: string; children: ReactNode }) {
  const [{ candidateId, profile, inView, locale, sections }, { atsScore, versions, aiActivity }, t] = await Promise.all([loadProfilePage(id), loadProfileAside(id), getServerT()]);
  const links = profileFicheLinks({ id: profile.id, sections, currentVersion: profile.masterCv.version, versions }, t, locale);
  return (
    <ObjectConversation
      candidateId={candidateId}
      subject={{ kind: PROFILE, id: profile.id }}
      inView={inView}
      title={<ProfileTitle key={`title-${profile.id}`} profileId={profile.id} name={profile.name} />}
      currentProfileId={profile.id}
      aiActivity={aiActivity}
      fiche={{ card: <ProfileCard id={id} atsScore={atsScore?.score.score ?? null} t={t} />, ...links }}
      introduction={<p>{t("profilePage.conversation.introduction", { name: profile.name })}</p>}
      suggestions={SUGGESTIONS.map((suggestion) => ({
        label: t(`profilePage.conversation.suggestions.${suggestion}.label`),
        message: t(`profilePage.conversation.suggestions.${suggestion}.message`),
      }))}
    >
      {children}
    </ObjectConversation>
  );
}

/**
 * The Profile at a glance, first in its Fiche: what the page's head showed. Whether it is active or archived (and how to
 * restore it), « Chercher des offres » while it is active, its Search Criteria (changed in place, read-only while
 * archived), and its ATS Score, leading to its Section.
 */
async function ProfileCard({ id, atsScore, t }: { id: string; atsScore: number | null; t: T }) {
  const { profile, locale } = await loadProfilePage(id);
  // An archived Profile's Sectors and Domains are read by their labels (#236); an active one's inputs fetch them.
  const industries = profile.archived ? await readIndustryReference() : null;
  return (
    <div className="profile-card">
      <p className="profile-card__status">
        <Pill tone={profile.archived ? "neutral" : "success"}>{t(profile.archived ? "profilePage.status.archived" : "profilePage.status.active")}</Pill>
      </p>
      {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
      {profile.archived ? null : (
        <Link className={buttonClass({ size: "sm" })} href={routes.jobSearches(profile.id)}>
          <Icons.jobSearches />
          {t("profilePage.actions.searchOffers")}
        </Link>
      )}
      {profile.archived ? (
        <ArchivedCriteria criteria={profile.searchCriteria} locale={locale} t={t} industries={industries ?? { sectors: [], subsectors: [], domains: [] }} />
      ) : (
        <SearchCriteriaProperties key={`criteria-${profile.id}`} profileId={profile.id} searchCriteria={profile.searchCriteria} />
      )}
      <div className="profile-ats">
        {atsScore === null ? null : <Ring label={t("atsScore.title")} value={atsScore} />}
        <p className="profile-ats-text">{t(atsScore === null ? "profilePage.ats.none" : "profilePage.ats.computed")}</p>
      </div>
      <Link href={routes.profileSection(profile.id, ATS_SCORE)} scroll={false}>
        {t(atsScore === null ? "profilePage.ats.compute" : "profilePage.ats.open")}
      </Link>
    </div>
  );
}
