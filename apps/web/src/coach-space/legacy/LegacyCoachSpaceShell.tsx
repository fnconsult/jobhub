/* « Espace coach v2 » off (ADR-0106): copied from origin/main before the Human Coach epic (#867); retired with the old Coach space (#888). */
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicFooter } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** The Help Centre's topic of a Human Coach's articles (#554), where the coach space's « Centre d'aide » leads. */
const COACH_SPACE_HELP = routes.helpTopic("espace-coach");

/** Header of a Human Coach's pages. */
export async function LegacyCoachSpaceHeader() {
  const t = await getServerT();
  return (
    <header className="page-header">
      <Link className="brand" href={routes.coachSpace}>
        {`${t("app.name")} · ${t("coachSpace.title")}`}
      </Link>
      <div className="page-nav">
        <Link className="button" href={routes.account}>
          {t("nav.account")}
        </Link>
      </div>
    </header>
  );
}

/** A Human Coach's page: its header, the page, then the public site's footer (#544), its « Centre d'aide » the « Espace coach » topic (#554). */
export function LegacyCoachSpaceShell({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="page">
        <LegacyCoachSpaceHeader />
        {children}
      </main>
      <PublicFooter helpCentre={COACH_SPACE_HELP} />
    </>
  );
}
