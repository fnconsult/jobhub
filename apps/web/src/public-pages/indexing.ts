import { LEGAL_TEXTS, type LegalTextId } from "@jobhub/help";
import { SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import type { Metadata, MetadataRoute } from "next";
import { localePath } from "./public-shell";

/**
 * What search engines may index of the public site (#545, decided by #501, amended by #503 and ADR-0065):
 * - the indexed pages, in French and in English (`/en`): the home page, the Help Centre and its public Help Articles
 *   (never an Administrator's), each Legal Text in effect, the recipient list once #338 serves it, Nouveautés. Each
 *   carries its `canonical` and reciprocal `hreflang` (`fr`, `en`, `x-default` = French), and `sitemap.xml` lists them;
 * - every other page is `noindex`, the root layout's default: dated Legal Text Versions, sign-in, the unsubscribe page,
 *   the page shown once an account is deleted, every signed-in page, the coach space and the Back Office;
 * - on the Beta (anything but Production), nothing: every page `noindex`, `X-Robots-Tag` on every answer, `robots.txt`
 *   disallows everything and `sitemap.xml` lists nothing.
 * Pure: the pages' metadata, `robots.ts` and `sitemap.ts` read the request and the sources and call these.
 */

type Env = Record<string, string | undefined>;

/** The robots directive of a page not to index: `<meta name="robots" content="noindex">`. */
export const NOINDEX = { index: false } as const satisfies Metadata["robots"];
const INDEX = { index: true, follow: true } as const satisfies Metadata["robots"];

/** `X-Robots-Tag` on every answer of the Beta; none in Production. */
export function betaRobotsHeader(beta: boolean): string | null {
  return beta ? "noindex, nofollow" : null;
}

/**
 * The site's origin, which `canonical`, `hreflang` and the sitemap's URLs start with: APP_URL (set by
 * deploy/compose.yml for each environment), else a developer's machine. Never the request's host, which a client
 * chooses.
 */
export function siteOrigin(env: Env): string {
  return env.APP_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000";
}

/**
 * A public page's indexing metadata: `path` (without `/en`), shown at its address in `url`, is indexed in the
 * languages `indexedIn` names. Indexed in that language, it gets its `canonical` and its `hreflang` (each language it
 * is indexed in, `x-default` the French), and `index, follow` but on the Beta; otherwise `noindex`.
 */
export function publicPageMetadata({
  path,
  indexedIn,
  url,
  origin,
  beta,
}: {
  path: string;
  indexedIn: readonly Locale[];
  url: Locale;
  origin: string;
  beta: boolean;
}): Pick<Metadata, "alternates" | "robots"> {
  if (!indexedIn.includes(url)) return { robots: NOINDEX };
  return { alternates: { canonical: absolute(origin, path, url), languages: hreflang(origin, path, indexedIn) }, robots: beta ? NOINDEX : INDEX };
}

function absolute(origin: string, path: string, locale: Locale): string {
  return `${origin}${localePath(path, locale)}`;
}

function hreflang(origin: string, path: string, indexedIn: readonly Locale[]): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of SUPPORTED_LOCALES) if (indexedIn.includes(locale)) languages[locale] = absolute(origin, path, locale);
  if (indexedIn.includes("fr")) languages["x-default"] = absolute(origin, path, "fr");
  return languages;
}

/**
 * A Help Article as the Help Centre serves it (#549): its id, its audience and its topic (rubrique). Only an article
 * with a topic has a public address, `/aide/<topic>/<id>`, and an Administrator's never has one (ADR-0065).
 */
export type HelpCentreArticle = { id: string; audience?: string; topic?: string | null };

/** The Help Centre's public Help Articles' addresses, each once, never an Administrator's (ADR-0065). */
export function helpCentrePaths(articles: readonly HelpCentreArticle[]): string[] {
  const paths = articles.filter((entry) => entry.topic && entry.audience && entry.audience !== "administrator").map((entry) => `/aide/${entry.topic}/${entry.id}`);
  return [...new Set(paths)];
}

/**
 * The pages of Légal indexed besides the Legal Texts: the recipient list, `/legal/destinataires` (#503), joins them
 * when #338 serves it.
 */
export const INDEXED_LEGAL_PAGES: readonly string[] = [];

/** What the sitemap reads: the Help Articles and, for each Legal Text, the languages it is in effect in today. */
export type IndexSources = {
  helpArticles: readonly HelpCentreArticle[];
  legalTextInEffect: (text: LegalTextId, locale: Locale) => boolean;
};

/** The languages a Legal Text is indexed in: those it has a version in effect in (#501). */
export function legalTextIndexedIn(text: LegalTextId, inEffect: IndexSources["legalTextInEffect"]): Locale[] {
  return SUPPORTED_LOCALES.filter((locale) => inEffect(text, locale));
}

/** Every indexed page (without `/en`) and the languages it is indexed in, from the sources as they are today. */
export function indexedPages({ helpArticles, legalTextInEffect }: IndexSources): { path: string; indexedIn: Locale[] }[] {
  const everywhere = (path: string) => ({ path, indexedIn: [...SUPPORTED_LOCALES] });
  return [
    everywhere("/"),
    everywhere("/aide"),
    ...helpCentrePaths(helpArticles).map(everywhere),
    ...LEGAL_TEXTS.map((text) => ({ path: `/legal/${text}`, indexedIn: legalTextIndexedIn(text, legalTextInEffect) })).filter((page) => page.indexedIn.length > 0),
    ...INDEXED_LEGAL_PAGES.map(everywhere),
    everywhere("/nouveautes"),
  ];
}

/** `sitemap.xml`: each indexed page in each language it is indexed in, with its `hreflang`; nothing on the Beta. */
export function sitemapEntries({ origin, beta, sources }: { origin: string; beta: boolean; sources: IndexSources }): MetadataRoute.Sitemap {
  if (beta) return [];
  return indexedPages(sources).flatMap(({ path, indexedIn }) =>
    indexedIn.map((locale) => ({ url: absolute(origin, path, locale), alternates: { languages: hreflang(origin, path, indexedIn) } })),
  );
}

/** `robots.txt`: the public site allowed, the Back Office, the API and the coach space not, and the sitemap; on the Beta, nothing. */
export function robotsFile({ origin, beta }: { origin: string; beta: boolean }): MetadataRoute.Robots {
  if (beta) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/espace-coach"] }, sitemap: `${origin}/sitemap.xml` };
}
