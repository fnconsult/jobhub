import { nouveautes, releaseNotes } from "@jobhub/help";
import type { Metadata } from "next";
import { PublicSite } from "@/design/PublicSite";
import { ReleaseNotesView } from "@/design/ReleaseNotesView";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { nouveautesDeployment } from "@/public-pages/deployment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("publicSite.nouveautes")} · ${t("app.name")}` };
}

/**
 * Nouveautés (#470, ADR-0063): the Release Notes this build carries, newest first, in the page's language, filtered by
 * tag. On the Beta, the next Version's Release Note shows apart, under « Version bêta, pas encore publiée ». No
 * subscription form: the Nouveautés email is a Candidate's choice in Mon compte (#505).
 */
export default async function NouveautesPage() {
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  return (
    <PublicSite current="nouveautes">
      <main id="main" className="ds-site__page">
        <header className="ds-site__intro">
          <p className="ds-site__eyebrow">{t("nouveautes.eyebrow")}</p>
          <h1 className="ds-site__title">{t("nouveautes.title")}</h1>
          <p className="ds-site__subtitle">{t("nouveautes.subtitle")}</p>
        </header>
        <ReleaseNotesView {...nouveautes(releaseNotes(locale), nouveautesDeployment(process.env))} />
      </main>
    </PublicSite>
  );
}
