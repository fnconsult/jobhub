import type { Metadata } from "next";
import Link from "next/link";
import { getActionCards } from "@/action-cards/server";
import { atsFixOf } from "@/ats-score";
import { getAtsScoring } from "@/ats-score/server";
import { ActionCardList, type ActionCardView } from "@/components/ActionCardList";
import { AtsScoreView } from "@/components/AtsScoreView";
import { CoachInView } from "@/components/CoachPanel";
import { CvExportForm } from "@/components/CvExportForm";
import { MasterCvView } from "@/components/MasterCvView";
import { ProfileActions } from "@/components/ProfileActions";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnProfile } from "@/profiles/server";
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
 * One Profile: the AI Coach's Action Cards about it (ATS Fixes among them,
 * Senior Advice labelled), its Search Criteria, its ATS Score, the current
 * version of its Master CV, and what can be done with it.
 */
export default async function ProfilePage({ params }: Params) {
  const { candidateId, profile } = await currentProfile((await params).id);
  const t = await getServerT();
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const cards = await getActionCards().pending(candidateId, inView);
  const atsScore = await getAtsScoring().latest(candidateId, profile.id);
  const locale = await getRequestLocale();
  const { searchCriteria: criteria, masterCv } = profile;
  const notSpecified = t("profile.notSpecified");
  return (
    <main className="page">
      <WorkspaceHeader candidateId={candidateId} currentProfileId={profile.id} />
      <h1>{profile.name}</h1>
      {profile.archived ? <p className="notice">{t("profileActions.archivedNotice")}</p> : null}
      <CoachInView {...inView} />
      <ActionCardList
        key={`action-cards-${profile.id}`}
        cards={cards.map(({ id, title, body, kind, payload }): ActionCardView => {
          const seniorAdvice = atsFixOf({ kind, payload })?.category === "senior_advice";
          return seniorAdvice ? { id, title, body, label: t("atsFixes.seniorAdvice"), dismissLabel: t("atsFixes.dismissAdvice") } : { id, title, body };
        })}
      />

      <h2>{t("cvReview.searchCriteria")}</h2>
      <dl>
        <dt>{t("cvReview.targetRole")}</dt>
        <dd>{criteria.targetRole}</dd>
        <dt>{t("cvReview.location")}</dt>
        <dd>{criteria.location}</dd>
        <dt>{t("cvReview.minSalary")}</dt>
        <dd>
          {criteria.minSalary === undefined
            ? notSpecified
            : t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) })}
        </dd>
        <dt>{t("cvReview.contractType")}</dt>
        <dd>{criteria.contractType ? t(`cvReview.contractTypes.${criteria.contractType}`) : notSpecified}</dd>
        <dt>{t("cvReview.remoteWork")}</dt>
        <dd>{criteria.remoteWork ? t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) : notSpecified}</dd>
      </dl>

      <AtsScoreView
        profileId={profile.id}
        targetRole={criteria.targetRole}
        currentVersion={masterCv.version}
        atsScore={atsScore}
        t={t}
      />

      <h2>{t("profile.masterCv")}</h2>
      <p>{t("profile.version", { version: masterCv.version })}</p>
      <MasterCvView cv={masterCv.content} t={t} />
      <nav className="actions" aria-label={t("profile.masterCv")}>
        <Link className="button button-primary" href={routes.editMasterCv(profile.id)}>
          {t("profile.editMasterCv")}
        </Link>
        <Link className="button" href={routes.masterCvVersions(profile.id)}>
          {t("profile.versionHistory")}
        </Link>
      </nav>

      <CvExportForm profileId={profile.id} t={t} />

      <ProfileActions key={profile.id} profile={{ id: profile.id, name: profile.name, archived: profile.archived }} />

      <p>
        <Link href={routes.account}>{t("profile.backToAccount")}</Link>
      </p>
    </main>
  );
}
