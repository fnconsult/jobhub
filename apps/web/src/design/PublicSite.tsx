import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentCandidate } from "@/auth/server";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { buttonClass } from "./button-class";
import "./PublicSite.css";

/** The public pages the site header leads to (#470), in its order. */
const PAGES = [
  { page: "nouveautes", href: routes.nouveautes, label: "publicSite.nouveautes" },
  { page: "legal", href: routes.legal(), label: "publicSite.legal" },
] as const;
export type PublicPage = (typeof PAGES)[number]["page"];

const CURRENT_PAGE = "page";

/**
 * A public page (#470): no Sidebar, the site's header (the « Jobbbox » wordmark, Nouveautés, Légal and « Se connecter », or « Mon
 * compte » for a signed-in Candidate) sticky at the top, then the page. A sign-in page leaves out the sign-in link.
 * The canvas is `canvas` on a sign-in page: accent-tinted, its card centred.
 */
export async function PublicSite({ current, signInLink = true, children }: { current?: PublicPage; signInLink?: boolean; children: ReactNode }) {
  const t = await getServerT();
  const candidate = signInLink ? await getCurrentCandidate() : null;
  return (
    <div className="ds-site">
      <header className="ds-site__head">
        <Link className="ds-site__brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <nav className="ds-site__nav" aria-label={t("publicSite.nav")}>
          {PAGES.map(({ page, href, label }) => (
            <Link key={page} href={href} aria-current={current === page ? CURRENT_PAGE : undefined}>
              {t(label)}
            </Link>
          ))}
        </nav>
        {signInLink ? (
          <Link className={`${buttonClass({ size: "sm" })} ds-site__sign-in`} href={candidate ? routes.account : routes.signIn}>
            {candidate ? t("nav.account") : t("nav.signIn")}
          </Link>
        ) : null}
      </header>
      {children}
    </div>
  );
}
