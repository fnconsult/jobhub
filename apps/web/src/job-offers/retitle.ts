/**
 * The job-title correction of shared Job Offers already stored (#1128): each one's source page is read again, politely
 * (ADR-0002), and its title read with the rule the import now follows (`statedJobTitle`: its JobPosting's `title`, else
 * the posting's own `<h1>`, never a heading of the site's banner). A Job Offer whose source states another title takes
 * it. Run once per environment, first as a dry run that lists what would change (docs/ops/job-offer-titles.md).
 *
 *  - Only shared Job Offers with a source URL: a Private Job Offer (ADR-0049) comes from a recruiter's message, with no
 *    page to read again.
 *  - Never a Candidate's own title: a title a Candidate gave their Application (`application.job_title`, ADR-0117) is
 *    another column, never read nor written here. A Candidate who renamed their Application keeps their title.
 *  - No AI call: a page that states no title (no JobPosting, no posting heading), or cannot be read (gone, robots,
 *    bot protection, a Forbidden site, noindex), is left as it is and counted.
 *  - A title read from a heading only replaces one it has nothing in common with (#1154): a heading that holds the title
 *    or that the title holds (a place added, « Senior » left out, other case or accents) leaves it as it is, counted.
 *  - Idempotent: run again, a Job Offer whose title is the one its source states is unchanged. Each change applied is
 *    kept in `job_offer_title_correction` with the title before, so it can be read back or undone by hand.
 */
import { metaRobots, statedJobTitle } from "@jobhub/shared/page-reading";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool";

/** What reading a source page gave: its HTML, or why there is none. */
export type SourcePage = { ok: true; html: string } | { ok: false; reason: string };

export interface TitleCorrection {
  jobOfferId: string;
  sourceUrl: string;
  before: string;
  after: string;
  /** Where the source states it: its JobPosting's `title`, or the posting's `<h1>`. */
  from: "job_posting" | "heading";
}

export interface RetitleReport {
  /** Shared Job Offers with a source URL looked at. */
  read: number;
  /** Those whose source states another title: listed in a dry run, changed when applied. */
  corrections: TitleCorrection[];
  /** Those whose source states the title they have. */
  unchanged: number;
  /** Those whose source states no title, or could not be read, by reason. */
  skipped: Record<string, number>;
  applied: boolean;
}

/** A title as compared with another: its case, accents, dashes and spaces left aside. */
const comparable = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‐-―−-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Whether either title holds the other (#1154). */
export function overlaps(heading: string, title: string): boolean {
  const [a, b] = [comparable(heading), comparable(title)];
  return a.includes(b) || b.includes(a);
}

/** Longest title a Job Offer takes, as its capture validates it. */
const MAX_TITLE = 500;

export async function migrateJobOfferTitleCorrections(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_offer_title_correction (
      id bigserial PRIMARY KEY,
      job_offer_id uuid NOT NULL REFERENCES job_offer (id) ON DELETE CASCADE,
      title_before text NOT NULL,
      title_after text NOT NULL,
      stated_by text NOT NULL CHECK (stated_by IN ('job_posting', 'heading')),
      corrected_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS job_offer_title_correction_job_offer_idx ON job_offer_title_correction (job_offer_id);
  `);
}

/**
 * Reads each shared Job Offer's source page with `read` and lists the titles to correct; with `apply`, corrects them.
 * `limit`: at most that many Job Offers, oldest first; `after`: those captured after this id's, to go on from a run.
 */
export async function retitleJobOffers(
  database: Pool,
  { read, apply, limit, onProgress }: { read: (url: string) => Promise<SourcePage>; apply: boolean; limit?: number; onProgress?: (line: string) => void },
): Promise<RetitleReport> {
  if (apply) await migrateJobOfferTitleCorrections(database);
  const { rows } = await database.query<{ id: string; title: string; source_url: string }>(
    `SELECT id, title, source_url FROM job_offer
      WHERE private_to_candidate_id IS NULL AND source_url IS NOT NULL
      ORDER BY created_at, id ${limit === undefined ? "" : "LIMIT $1"}`,
    limit === undefined ? [] : [limit],
  );
  const report: RetitleReport = { read: rows.length, corrections: [], unchanged: 0, skipped: {}, applied: apply };
  const skip = (reason: string) => (report.skipped[reason] = (report.skipped[reason] ?? 0) + 1);
  for (const row of rows) {
    const page = await read(row.source_url).catch((): SourcePage => ({ ok: false, reason: "unreachable" }));
    if (!page.ok) {
      skip(page.reason);
      continue;
    }
    if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) {
      skip("robots");
      continue;
    }
    const stated = statedJobTitle(page.html);
    if (!stated) {
      skip("no_stated_title");
      continue;
    }
    const after = stated.title.slice(0, MAX_TITLE);
    if (after === row.title) {
      report.unchanged += 1;
      continue;
    }
    // A heading only replaces a title it has nothing in common with (a slogan): one that holds it, or that it holds,
    // only says it otherwise (a place added, « Senior » left out, other case or accents), and the title read stays.
    if (stated.from === "heading" && overlaps(after, row.title)) {
      skip("heading_overlaps_title");
      continue;
    }
    const correction: TitleCorrection = { jobOfferId: row.id, sourceUrl: row.source_url, before: row.title, after, from: stated.from };
    report.corrections.push(correction);
    onProgress?.(`${apply ? "corrigé" : "à corriger"} ${row.id} : « ${row.title} » → « ${after} » (${stated.from})`);
    if (!apply) continue;
    await inTransaction(database, async (client) => {
      // Only from the title read above: a Job Offer changed meanwhile is left for the next run.
      const { rowCount } = await client.query(`UPDATE job_offer SET title = $2 WHERE id = $1 AND title = $3`, [row.id, after, row.title]);
      if (rowCount) {
        await client.query(`INSERT INTO job_offer_title_correction (job_offer_id, title_before, title_after, stated_by) VALUES ($1, $2, $3, $4)`, [
          row.id,
          row.title,
          after,
          stated.from,
        ]);
      }
    });
  }
  return report;
}
