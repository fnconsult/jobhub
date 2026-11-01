import type { Metadata } from "next";
import { EmptyState } from "@/design/EmptyState";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { publicMetadata } from "@/public-pages/indexing-server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("helpCentre.title")} · ${t("app.name")}`, ...(await publicMetadata(routes.help, ["fr", "en"])) };
}

/**
 * The Help Centre (#544), where the public header's « Aide » and the Sidebar's « Aide et légal » lead: « Le centre
 * d'aide arrive bientôt » until #549 brings its Help Articles. In the page's language.
 */
export default async function HelpCentrePage() {
  const t = await getServerT();
  return (
    <PublicSite current="aide">
      <main id="main" className="ds-site__page">
        <header className="ds-site__intro">
          <p className="ds-site__eyebrow">{t("helpCentre.eyebrow")}</p>
          <h1 className="ds-site__title">{t("helpCentre.title")}</h1>
        </header>
        <EmptyState title={t("helpCentre.comingSoonTitle")}>{t("helpCentre.comingSoon")}</EmptyState>
      </main>
    </PublicSite>
  );
}
