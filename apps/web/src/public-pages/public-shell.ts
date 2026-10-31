import { SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import type { ParseKeys } from "i18next";
import { routes } from "@/routes";

/** A link of the public shell: `label` is its catalogue key. */
export type ShellLink = { key: string; href: string; label: ParseKeys };

/**
 * `href` in the language the page's URL chose (`?lang=`, src/proxy.ts), so a Visitor who picked English stays in it
 * from page to page; unchanged when the URL chose none, or for a link out of the site. The `/en` prefix (#545) will
 * take its place.
 */
export function withLang(href: string, lang?: Locale): string {
  if (!lang || !href.startsWith("/")) return href;
  const hash = href.indexOf("#");
  const [path, anchor] = hash < 0 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  const query = path.indexOf("?");
  const [pathname, search] = query < 0 ? [path, ""] : [path.slice(0, query), path.slice(query + 1)];
  const params = new URLSearchParams(search);
  params.set("lang", lang);
  return `${pathname}?${params.toString()}${anchor}`;
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
        { key: "cgu", href: routes.legal("conditions-utilisation"), label: "publicFooter.legal.cgu" },
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

/** The page asked (`path`, its query included) in each language: the FR/EN switch. */
export function languageLinks(path: string): { locale: Locale; href: string }[] {
  return SUPPORTED_LOCALES.map((locale) => ({ locale, href: withLang(path, locale) }));
}
