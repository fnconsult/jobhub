import type { MetadataRoute } from "next";
import { robotsFile } from "@/public-pages/indexing";
import { requestOrigin } from "@/public-pages/indexing-server";
import { currentRelease } from "@/release";

/** `robots.txt` (#545), at each request: the public site and its sitemap in Production; nothing on the Beta. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFile({ origin: await requestOrigin(), beta: currentRelease(process.env).beta });
}
