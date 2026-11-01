import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CandidateLayout } from "@/components/CandidateLayout";
import { MasterCvView } from "@/components/MasterCvView";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { RestoreVersionButton } from "@/components/RestoreVersionButton";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { getServerT } from "@/i18n/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

/** What it is in the Work Pane. */
const RESULT: AddressedKind = "result";

type Params = { params: Promise<{ id: string; version: string }> };

async function currentVersion(params: Params["params"]) {
  const { id, version } = await params;
  const { candidateId, profile } = await requireOwnProfile(id);
  const shown = /^\d+$/.test(version) ? (await getProfiles().masterCvVersions(candidateId, profile.id))?.find((v) => v.version === Number(version)) : undefined;
  if (!shown) notFound();
  return { candidateId, profile, shown };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile, shown } = await currentVersion(params);
  return { title: `${t("versions.viewTitle", { version: shown.version })} · ${profile.name} · ${t("app.name")}` };
}

/**
 * One saved version of a Profile's Master CV, read-only, with a way to restore it. Under « Conversation au centre »
 * (#605, ADR-0070), one of the Profile's Results, in the Work Pane beside its conversation.
 */
export default async function MasterCvVersionPage({ params }: Params) {
  const { candidateId, profile, shown } = await currentVersion(params);
  const t = await getServerT();
  const current = shown.version === profile.masterCv.version;
  const version = (
    <>
      {current ? <p className="version-current">{t("versions.current")}</p> : null}
      {shown.restoredFrom !== null ? <p>{t("versions.restoredFrom", { version: shown.restoredFrom })}</p> : null}
      <MasterCvView cv={shown.content} t={t} />
      <div className="actions">
        {current ? null : <RestoreVersionButton profileId={profile.id} version={shown.version} />}
        <Link className="button" href={routes.masterCvVersions(profile.id)} scroll={false}>
          {t("versions.backToHistory")}
        </Link>
      </div>
    </>
  );
  if (pagesAreConversations())
    return (
      <InWorkPane kind={RESULT} title={t("versions.viewTitle", { version: shown.version })} href={routes.masterCvVersion(profile.id, shown.version)} back={routes.profile(profile.id)}>
        {version}
      </InWorkPane>
    );
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id} title={t("versions.viewTitle", { version: shown.version })}>
      <p className="lead">{profile.name}</p>
      {version}
    </CandidateLayout>
  );
}
