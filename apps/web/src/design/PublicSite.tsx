import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentCandidate } from "@/auth/server";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getRequestLocale, getServerT, getUrlLocale } from "@/i18n/server";
import { extensionStorePage } from "@/platform-settings/extension-store";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { publicContactEmail } from "@/public-pages/contact-email";
import { footerColumns, HEADER_LINKS, languageLinks, withLang, type PublicPage } from "@/public-pages/public-shell";
import { REQUEST_PATH_HEADER } from "@/request-path";
import { routes } from "@/routes";
import { buttonClass } from "./button-class";
import { PublicSiteMenu } from "./PublicSiteMenu";
import "./PublicSite.css";

export type { PublicPage };

const CURRENT_PAGE = "page";

/**
 * A public page (#470, #544): no Sidebar; the site's header sticky at the top (the « Jobbbox » wordmark, Nouveautés,
 * Aide and Légal, behind « Menu » on a phone; the FR/EN switch, the text size, and « Se connecter », or « Mon compte »
 * for a signed-in Candidate), then the page, then the public footer. A sign-in page leaves out the sign-in link.
 * Its links keep the language the URL chose (see withLang).
 */
export async function PublicSite({ current, signInLink = true, children }: { current?: PublicPage; signInLink?: boolean; children: ReactNode }) {
  const t = await getServerT();
  const lang = await getUrlLocale();
  const candidate = signInLink ? await getCurrentCandidate() : null;
  return (
    <div className="ds-site">
      <header className="ds-site__head">
        <Link className="ds-site__brand" href={withLang(routes.home, lang)}>
          {t("app.name")}
        </Link>
        <PublicSiteMenu label={t("publicSite.nav")} menu={t("publicSite.menu")}>
          {HEADER_LINKS.map(({ key, href, label }) => (
            <Link key={key} href={withLang(href, lang)} aria-current={current === key ? CURRENT_PAGE : undefined}>
              {t(label)}
            </Link>
          ))}
        </PublicSiteMenu>
        <div className="ds-site__tools">
          <LanguageSwitch label={t("publicSite.language")} />
          <TextSizeControl />
        </div>
        {signInLink ? (
          <Link className={`${buttonClass({ size: "sm" })} ds-site__sign-in`} href={candidate ? routes.account : withLang(routes.signIn, lang)}>
            {candidate ? t("nav.account") : t("nav.signIn")}
          </Link>
        ) : null}
      </header>
      {children}
      <PublicFooter signInLink={signInLink} />
    </div>
  );
}

/**
 * The FR/EN switch (#544): the page asked, in each language; the page's own marked as current. Each reads out its
 * language's name, in itself (the same in both catalogues).
 */
async function LanguageSwitch({ label }: { label: string }) {
  const t = await getServerT();
  const locale = await getRequestLocale();
  const path = (await headers()).get(REQUEST_PATH_HEADER) ?? routes.home;
  return (
    <nav className="ds-site__languages" aria-label={label}>
      {languageLinks(path).map(({ locale: language, href }) => (
        <a key={language} href={href} lang={language} hrefLang={language} aria-current={language === locale ? "true" : undefined}>
          <span aria-hidden="true">{t(`publicSite.languages.${language}.short`)}</span>
          <span className="visually-hidden">{t(`publicSite.languages.${language}.name`)}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * The public footer (#544): Légal, Aide and Jobbbox in three columns, then the FR/EN switch and « © Jobbbox ». On every
 * public page, and under the coach space's pages. Without `signInLink` (a sign-in page), no « Se connecter ».
 */
export async function PublicFooter({ signInLink = true }: { signInLink?: boolean }) {
  const t = await getServerT();
  const lang = await getUrlLocale();
  const account = signInLink ? ((await getCurrentCandidate()) ? "account" : "signIn") : null;
  const columns = footerColumns({ contactEmail: publicContactEmail(), extensionStore: extensionStorePage(getPlatformSettingsResolver().current()), account });
  return (
    <footer className="ds-site__foot">
      <div className="ds-site__foot-columns">
        {columns.map((column) => (
          <nav key={column.key} className="ds-site__foot-column" aria-labelledby={`site-foot-${column.key}`}>
            <h2 className="ds-site__foot-title" id={`site-foot-${column.key}`}>
              {t(column.label)}
            </h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.key}>
                  {link.href.startsWith("/") ? <Link href={withLang(link.href, lang)}>{t(link.label)}</Link> : <a href={link.href}>{t(link.label)}</a>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="ds-site__foot-end">
        <LanguageSwitch label={t("publicFooter.language")} />
        <p className="ds-site__copyright">{t("publicFooter.copyright")}</p>
      </div>
    </footer>
  );
}
