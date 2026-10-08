import type { Metadata } from "next";
import Link from "next/link";
import { RestoreVersionButton } from "@/components/RestoreVersionButton";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles, requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { profile } = await requireOwnProfile((await params).id);
  return { title: `${t("versions.title")} · ${profile.name} · ${t("app.name")}` };
}

/** Every version of a Profile's Master CV, newest first, each viewable and restorable. */
export default async function MasterCvVersionsPage({ params }: Params) {
  const { candidateId, profile } = await requireOwnProfile((await params).id);
  const versions = (await getProfiles().masterCvVersions(candidateId, profile.id)) ?? [];
  const t = await getServerT();
  const dateFormat = new Intl.DateTimeFormat(await getRequestLocale(), { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{t("versions.title")}</h1>
      <p className="lead">{profile.name}</p>
      <p>{t("versions.intro")}</p>
      <ol className="version-list">
        {versions.map((version) => {
          const current = version.version === profile.masterCv.version;
          return (
            <li key={version.version} className="version">
              <h2>{t("versions.version", { version: version.version })}</h2>
              <p>{t("versions.savedAt", { date: dateFormat.format(version.savedAt) })}</p>
              {current ? <p className="version-current">{t("versions.current")}</p> : null}
              {version.restoredFrom !== null ? <p>{t("versions.restoredFrom", { version: version.restoredFrom })}</p> : null}
              <div className="actions">
                <Link className="button" href={routes.masterCvVersion(profile.id, version.version)}>
                  {t("versions.view", { version: version.version })}
                </Link>
                {current ? null : <RestoreVersionButton profileId={profile.id} version={version.version} />}
              </div>
            </li>
          );
        })}
      </ol>
      <p>
        <Link href={routes.profile(profile.id)}>{t("versions.backToProfile")}</Link>
      </p>
    </main>
  );
}
