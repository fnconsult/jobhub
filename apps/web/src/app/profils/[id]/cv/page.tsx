import type { Metadata } from "next";
import { CandidateLayout } from "@/components/CandidateLayout";
import { MasterCvEditor } from "@/components/MasterCvEditor";
import { getServerT } from "@/i18n/server";
import { requireOwnProfile } from "@/profiles/server";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await requireOwnProfile((await params).id);
  return { title: `${t("cvEditor.title")} · ${profile.name} · ${t("app.name")}` };
}

/** Editing the current version of a Profile's Master CV. */
export default async function EditMasterCvPage({ params }: Params) {
  const { candidateId, profile } = await requireOwnProfile((await params).id);
  const t = await getServerT();
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id}>
      <h1>{t("cvEditor.title")}</h1>
      <p className="lead">{profile.name}</p>
      <p>{t("cvEditor.intro")}</p>
      <p>{t("cvEditor.editingVersion", { version: profile.masterCv.version })}</p>
      <MasterCvEditor profileId={profile.id} version={profile.masterCv.version} content={profile.masterCv.content} />
    </CandidateLayout>
  );
}
