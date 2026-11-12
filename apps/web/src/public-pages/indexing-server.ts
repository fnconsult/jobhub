import { articlesFor, legalText, parisDay, type LegalTextId } from "@jobhub/help";
import type { Locale } from "@jobhub/shared/i18n";
import type { Metadata } from "next";
import { connection } from "next/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getUrlLocale } from "@/i18n/server";
import { currentRelease } from "@/release";
import { readHumanCoachPath } from "@/landing/server";
import { legalTextIndexedIn, publicPageMetadata, siteOrigin, type IndexSources } from "./indexing";

/** The site's origin (see siteOrigin). Reading the request makes robots.txt and the sitemap answer at each request. */
export async function requestOrigin(): Promise<string> {
  await connection();
  return siteOrigin(process.env);
}

/**
 * The sources of the indexed pages, as this build carries them, on today's date in France: the Help Articles served
 * under « Espace coach v2 » (#867), main's while it is off, so no address of the epic's articles is indexed then.
 */
export function indexSources(on: string = parisDay(), coachSpaceV2: boolean = coachSpaceV2On()): IndexSources {
  return {
    helpArticles: articlesFor("fr", { coachSpaceV2 }),
    legalTextInEffect: (text, locale) => legalText(text, locale, { on })?.inEffect === true,
    humanCoachPath: readHumanCoachPath(),
  };
}

/**
 * The indexing metadata of the public page `path` (without `/en`), indexed in `indexedIn` (#545, see
 * publicPageMetadata): what its `generateMetadata` adds to its title.
 */
export async function publicMetadata(path: string, indexedIn: readonly Locale[]): Promise<Pick<Metadata, "alternates" | "robots">> {
  return publicPageMetadata({ path, indexedIn, url: (await getUrlLocale()) ?? "fr", origin: await requestOrigin(), beta: currentRelease(process.env).beta });
}

/** The indexing metadata of a Legal Text's page: indexed in the languages it has a version in effect in. */
export async function legalTextMetadata(text: LegalTextId): Promise<Pick<Metadata, "alternates" | "robots">> {
  return publicMetadata(`/legal/${text}`, legalTextIndexedIn(text, indexSources().legalTextInEffect));
}
