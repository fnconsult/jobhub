import { SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import type { ParseKeys } from "i18next";
import { ENGLISH_PREFIX, isPublicPage, splitLocalePrefix } from "@/i18n/locale-header";
import { routes } from "@/routes";

/** A link of the public shell: `label` is its catalogue key. */
export type ShellLink = { key: string; href: string; label: ParseKeys };

/**
 * `href` (a path of this site, its query and anchor included) at its address in `locale` (#545): under `/en` in English
 * (`/en` for the home page), unprefixed in French. Unchanged without a locale, for a link out of the site, for a page
 * that is not public (« Mon compte »: only the public pages are served under `/en`), or for a path already under `/en`.
 */
export function localePath(href: string, locale?: Locale): string {
  if (locale !== "en" || !href.startsWith("/")) return href;
  const { pathname } = parts(href);
  if (splitLocalePrefix(pathname).locale === "en" || !isPublicPage(pathname)) return href;
  return href === "/" ? ENGLISH_PREFIX : /^\/[?#]/.test(href) ? `${ENGLISH_PREFIX}${href.slice(1)}` : `${ENGLISH_PREFIX}${href}`;
}

/**
 * `href` with the URL's `lang` (#544), before its anchor, its query kept: the language a page shows whoever reads it,
 * a signed-in Candidate's Interface Language included (« Lire le texte français », the switch of a signed-in
 * Candidate). Unchanged without a language, or for a link out of the site.
 */
export function withLang(href: string, lang?: Locale): string {
  if (!lang || !href.startsWith("/")) return href;
  const { pathname, params, anchor } = parts(href);
  params.set("lang", lang);
  return `${pathname}?${params.toString()}${anchor}`;
}

/**
 * A link of the public shell from a page whose URL is in `url` (#545): at its address in that language, so a Visitor
 * who picked English stays in it from page to page; with `lang` too when the page's URL had one (see withLang).
 */
export function shellHref(href: string, { url, lang }: { url?: Locale | undefined; lang?: Locale | undefined }): string {
  return withLang(localePath(href, url ?? lang), lang);
}

function parts(href: string): { pathname: string; params: URLSearchParams; anchor: string } {
  const hash = href.indexOf("#");
  const [path, anchor] = hash < 0 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  const query = path.indexOf("?");
  const [pathname, search] = query < 0 ? [path, ""] : [path.slice(0, query), path.slice(query + 1)];
  return { pathname, params: new URLSearchParams(search), anchor };
}

/** The public header's links (#544), in its order; « Se connecter » or « Mon compte » come apart. */
export const HEADER_LINKS = [
  { key: "nouveautes", href: routes.nouveautes, label: "publicSite.nouveautes" },
  { key: "aide", href: routes.help, label: "publicSite.help" },
  { key: "legal", href: routes.legal(), label: "publicSite.legal" },
] as const satisfies ReadonlyArray<ShellLink>;
export type PublicPage = (typeof HEADER_LINKS)[number]["key"];

/** « Aide et légal », at the foot of the Candidate's Sidebar (#544). */
export const AIDE_ET_LEGAL = [
  { key: "aide", href: routes.help, label: "publicSite.help" },
  { key: "legal", href: routes.legal(), label: "publicSite.legal" },
  { key: "nouveautes", href: routes.nouveautes, label: "publicSite.nouveautes" },
] as const satisfies ReadonlyArray<ShellLink>;

export type FooterColumn = { key: "legal" | "help" | "jobbbox"; label: ParseKeys; links: ShellLink[] };

/**
 * The public footer's three columns (#544, decided by #501): Légal, Aide and Jobbbox. « IA dans Jobbbox » is a
 * section of the privacy policy (#503). « Nous contacter » writes to `contactEmail`, « Extension » opens its store
 * page (`extensionStore`); while either is unset, it leads to the Help Centre. Jobbbox's last link is « Se connecter »,
 * « Mon compte » for a signed-in Candidate (`account`), none on a sign-in page (`null`), like the header's.
 */
export function footerColumns({
  contactEmail,
  extensionStore,
  account = "signIn",
}: {
  contactEmail?: string | undefined;
  extensionStore?: string | null | undefined;
  account?: "signIn" | "account" | null;
}): FooterColumn[] {
  return [
    {
      key: "legal",
      label: "publicFooter.legal.title",
      links: [
        { key: "mentionsLegales", href: routes.legal("mentions-legales"), label: "publicFooter.legal.mentionsLegales" },
        { key: "cgu", href: routes.legal("cgu"), label: "publicFooter.legal.cgu" },
        { key: "cgv", href: routes.legal("cgv"), label: "publicFooter.legal.cgv" },
        { key: "confidentialite", href: routes.legal("confidentialite"), label: "publicFooter.legal.confidentialite" },
        { key: "ia", href: `${routes.legal("confidentialite")}#ia`, label: "publicFooter.legal.ia" },
      ],
    },
    {
      key: "help",
      label: "publicFooter.help.title",
      links: [
        { key: "helpCentre", href: routes.help, label: "publicFooter.help.helpCentre" },
        { key: "contact", href: contactEmail ? `mailto:${contactEmail}` : routes.help, label: "publicFooter.help.contact" },
        { key: "extension", href: extensionStore ?? routes.help, label: "publicFooter.help.extension" },
      ],
    },
    {
      key: "jobbbox",
      label: "app.name",
      links: [
        { key: "nouveautes", href: routes.nouveautes, label: "publicSite.nouveautes" },
        ...(account === "signIn" ? [{ key: "signIn", href: routes.signIn, label: "nav.signIn" } as const] : []),
        ...(account === "account" ? [{ key: "account", href: routes.account, label: "nav.account" } as const] : []),
      ],
    },
  ];
}

/**
 * The page asked (`path`, as asked: `/en` and its query included) in each language: the FR/EN switch (#544, #545).
 * Each leads to the page's address in that language, its `lang` dropped. A signed-in Candidate reads every page in
 * their Interface Language (#501), so their switch also says `lang`, which comes first.
 */
export function languageLinks(path: string, { signedIn = false }: { signedIn?: boolean } = {}): { locale: Locale; href: string }[] {
  const { pathname, params, anchor } = parts(path);
  params.delete("lang");
  const search = params.toString();
  const page = `${splitLocalePrefix(pathname).pathname}${search ? `?${search}` : ""}${anchor}`;
  return SUPPORTED_LOCALES.map((locale) => {
    const href = localePath(page, locale);
    return { locale, href: signedIn ? withLang(href, locale) : href };
  });
}
