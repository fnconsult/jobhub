import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MasterCvView } from "@/components/MasterCvView";
import { RestoreVersionButton } from "@/components/RestoreVersionButton";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string; version: string }> };

async function currentVersion(params: Params["params"]) {
  const { id, version } = await params;
  const { candidateId, profile } = await requireOwnProfile(id);
  const shown = /^\d+$/.test(version) ? (await getProfiles().masterCvVersions(candidateId, profile.id))?.find((v) => v.version === Number(version)) : undefined;
  if (!shown) notFound();
  return { profile, shown };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile, shown } = await currentVersion(params);
  return { title: `${t("versions.viewTitle", { version: shown.version })} · ${profile.name} · ${t("app.name")}` };
}

/** One saved version of a Profile's Master CV, read-only, with a way to restore it. */
export default async function MasterCvVersionPage({ params }: Params) {
  const { profile, shown } = await currentVersion(params);
  const t = await getServerT();
  const current = shown.version === profile.masterCv.version;
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{t("versions.viewTitle", { version: shown.version })}</h1>
      <p className="lead">{profile.name}</p>
      {current ? <p className="version-current">{t("versions.current")}</p> : null}
      {shown.restoredFrom !== null ? <p>{t("versions.restoredFrom", { version: shown.restoredFrom })}</p> : null}
      <MasterCvView cv={shown.content} t={t} />
      <div className="actions">
        {current ? null : <RestoreVersionButton profileId={profile.id} version={shown.version} />}
        <Link className="button" href={routes.masterCvVersions(profile.id)}>
          {t("versions.backToHistory")}
        </Link>
      </div>
    </main>
  );
}
