// Corrects the titles of the shared Job Offers already stored, read again from their source page with the import's
// rule (#1128): their JobPosting's `title`, else the posting's own <h1>, never the site banner's. docs/ops/job-offer-titles.md.
// Usage: npm run db:retitle-job-offers                  a dry run: lists what would change, changes nothing
//        npm run db:retitle-job-offers -- --apply      changes them, keeping each change in job_offer_title_correction
//        --limit N                                     at most N Job Offers, oldest first
import { FORBIDDEN_SITES } from "@jobhub/shared";
import { createPoliteFetcher, DEFAULT_USER_AGENT } from "@jobhub/shared/page-reading";
import { Pool } from "pg";
import { retitleJobOffers } from "../src/job-offers/retitle";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitAt = args.findIndex((arg) => arg === "--limit" || arg.startsWith("--limit="));
const limitText = limitAt < 0 ? undefined : args[limitAt]!.includes("=") ? args[limitAt]!.split("=")[1] : args[limitAt + 1];
const limit = limitText === undefined ? undefined : Number(limitText);
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
  console.error("[retitle-job-offers] Usage: [--apply] [--limit N], N a positive whole number");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("[retitle-job-offers] Missing environment variable DATABASE_URL");
  process.exit(2);
}
const fetcher = createPoliteFetcher({ fetch: globalThis.fetch, userAgent: DEFAULT_USER_AGENT, forbiddenSites: FORBIDDEN_SITES, timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
const database = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const report = await retitleJobOffers(database, {
    apply,
    ...(limit === undefined ? {} : { limit }),
    read: async (url) => {
      const page = await fetcher.page(url);
      return page.ok === true ? { ok: true, html: page.html } : { ok: false, reason: page.ok === false ? page.reason : "redirected" };
    },
    onProgress: (line) => console.info(`[retitle-job-offers] ${line}`),
  });
  const skipped = Object.entries(report.skipped).map(([reason, count]) => `${reason} ${count}`).join(", ") || "aucune";
  console.info(
    `[retitle-job-offers] ${apply ? "Appliqué" : "Essai à blanc (rien n'est changé ; --apply pour corriger)"} : ${report.read} offres lues, ` +
      `${report.corrections.length} ${apply ? "corrigées" : "à corriger"}, ${report.unchanged} déjà justes, laissées : ${skipped}.`,
  );
} catch (error) {
  console.error(`[retitle-job-offers] ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await database.end();
}
