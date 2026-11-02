import type { Metadata } from "next";
import { MasterCvEditor } from "@/components/MasterCvEditor";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { getServerT } from "@/i18n/server";
import { requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

/** What it is in the Work Pane. */
const SECTION: AddressedKind = "section";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await requireOwnProfile((await params).id);
  return { title: `${t("cvEditor.title")} · ${profile.name} · ${t("app.name")}` };
}

/**
 * Editing the current version of a Profile's Master CV, in the Work Pane beside the Profile's conversation (#605,
 * ADR-0070).
 */
export default async function EditMasterCvPage({ params }: Params) {
  const { profile } = await requireOwnProfile((await params).id);
  const t = await getServerT();
  return (
    <InWorkPane kind={SECTION} title={t("cvEditor.title")} href={routes.editMasterCv(profile.id)} back={routes.profile(profile.id)}>
      <p>{t("cvEditor.intro")}</p>
      <p>{t("cvEditor.editingVersion", { version: profile.masterCv.version })}</p>
      <MasterCvEditor profileId={profile.id} version={profile.masterCv.version} content={profile.masterCv.content} />
    </InWorkPane>
  );
}
