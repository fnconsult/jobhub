import type { Metadata } from "next";
import Link from "next/link";
import { MasterCvEditor } from "@/components/MasterCvEditor";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await requireOwnProfile((await params).id);
  return { title: `${t("cvEditor.title")} · ${profile.name} · ${t("app.name")}` };
}

/** Editing the current version of a Profile's Master CV. */
export default async function EditMasterCvPage({ params }: Params) {
  const { profile } = await requireOwnProfile((await params).id);
  const t = await getServerT();
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{t("cvEditor.title")}</h1>
      <p className="lead">{profile.name}</p>
      <p>{t("cvEditor.intro")}</p>
      <p>{t("cvEditor.editingVersion", { version: profile.masterCv.version })}</p>
      <MasterCvEditor profileId={profile.id} version={profile.masterCv.version} content={profile.masterCv.content} />
    </main>
  );
}
