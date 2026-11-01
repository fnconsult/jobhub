import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/public-pages/indexing";
import { indexSources, requestOrigin } from "@/public-pages/indexing-server";
import { currentRelease } from "@/release";

/**
 * `sitemap.xml` (#545), generated at each request from the sources this build carries (the public Help Articles, the
 * Legal Texts in effect today, Nouveautés), in French and in English: a page added later joins it untouched. Empty on
 * the Beta.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries({ origin: await requestOrigin(), beta: currentRelease(process.env).beta, sources: indexSources() });
}
