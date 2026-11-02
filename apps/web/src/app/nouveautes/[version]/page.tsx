import { nouveautes, releaseNotes, type Nouveautes } from "@jobhub/help";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicSite } from "@/design/PublicSite";
import { ReleaseNotesView } from "@/design/ReleaseNotesView";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { nouveautesDeployment } from "@/public-pages/deployment";
import { publicMetadata } from "@/public-pages/indexing-server";
import { routes } from "@/routes";

type Props = { params: Promise<{ version: string }> };

/** What Nouveautés shows of one Version (`X.Y.Z`): its Release Note, published or, on the Beta, the next one. Null: none. */
async function oneVersion(version: string): Promise<Nouveautes | null> {
  const shown = nouveautes(releaseNotes(await getRequestLocale()), nouveautesDeployment(process.env));
  const beta = shown.beta?.version === version ? shown.beta : null;
  const published = shown.published.filter((note) => note.version === version);
  return beta || published.length ? { beta, published } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params;
  const t = await getServerT();
  const note = await oneVersion(decodeURIComponent(version));
  const title = note?.beta?.title ?? note?.published[0]?.title ?? t("publicSite.nouveautes");
  return { title: `${title} · ${t("app.name")}`, ...(await publicMetadata(routes.nouveautesVersion(decodeURIComponent(version)), ["fr", "en"])) };
}

/**
 * One Version's Release Note on Nouveautés (#566): where the Nouveautés email leads. The same block as on Nouveautés,
 * with the link back to every Release Note; 404 for a Version this deployment does not show.
 */
export default async function NouveautesVersionPage({ params }: Props) {
  const { version } = await params;
  const shown = await oneVersion(decodeURIComponent(version));
  if (!shown) notFound();
  const t = await getServerT(await getRequestLocale());
  return (
    <PublicSite current="nouveautes">
      <main id="main" className="ds-site__page">
        <header className="ds-site__intro">
          <p className="ds-site__eyebrow">{t("nouveautes.eyebrow")}</p>
          <h1 className="ds-site__title">{t("nouveautes.version", { version: decodeURIComponent(version) })}</h1>
          <p className="ds-site__subtitle">
            <Link href={routes.nouveautes}>{t("nouveautes.allVersions")}</Link>
          </p>
        </header>
        <ReleaseNotesView {...shown} />
      </main>
    </PublicSite>
  );
}
