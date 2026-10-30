import Link from "next/link";
import type { ReactNode } from "react";
import { PublicFooter } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** Header of a Human Coach's pages. */
export async function CoachSpaceHeader() {
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

/** A Human Coach's page: its header, the page, then the public site's footer (#544). */
export function CoachSpaceShell({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="page">
        <CoachSpaceHeader />
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
