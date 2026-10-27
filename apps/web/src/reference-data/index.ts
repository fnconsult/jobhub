/**
 * Reference data (#236): the labels of the Sectors and Subsectors (INSEE's NAF rév. 2) and of the
 * Domains (France Travail's ROME 4.0 professional domains) the Search Criteria hold as codes,
 * fetched from their public sources (./sources.ts) and kept in the database.
 *
 *   const referenceData = createReferenceData(database, { externalApis });
 *   await referenceData.read();     // { sectors, subsectors, domains }: the labels, each list in order
 *   await referenceData.refresh();  // the worker's monthly job: ask both sources again
 *
 * A new database's first read asks the sources for what it does not hold yet, so the labels are
 * there before the worker's first refresh. A source that fails never fails a read: its labels are
 * those kept before (none on a new database, and it is not asked again for RETRY_AFTER_MS).
 * Each call is recorded as its Tool's ("insee-naf", "rome-open-data"); they are sent nothing.
 * Public nomenclatures, tied to no Candidate: not in the data export, kept on account deletion.
 */
import { recordingFetch, type ExternalApiLog, type IndustryReference, type ReferenceEntry } from "@jobhub/shared";
import type { Pool } from "pg";
import { fetchNaf, fetchRomeDomains } from "./sources";

export type { IndustryReference } from "@jobhub/shared";
export { fetchRomeJobs } from "./sources";

/** How long a source that failed on a read is left alone before a read asks it again. */
export const RETRY_AFTER_MS = 10 * 60 * 1000;

type Source = "naf" | "romeDomains";
type Kind = "sector" | "subsector" | "domain";

/** What a refresh did with each source. */
export type RefreshReport = Record<Source, "refreshed" | { failed: string }>;

export interface ReferenceData {
  /** The labels kept, each list in order; a source none of whose labels is kept yet is asked first. Never fails for a source. */
  read(): Promise<IndustryReference>;
  /** Asks each source again and replaces its labels with its answer; one that fails keeps those it had. */
  refresh(): Promise<RefreshReport>;
}

export interface ReferenceDataOptions {
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Where each call is recorded (Tools, AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
  now?: () => Date;
  /** Where a source's failure goes. Default: console.warn. */
  warn?: (line: string) => void;
}

interface Row {
  kind: Kind;
  code: string;
  parent: string | null;
  label_fr: string;
  label_en: string | null;
}

const entryOf = (row: Row): ReferenceEntry => ({
  code: row.code,
  ...(row.parent ? { parent: row.parent } : {}),
  label: row.label_en ? { fr: row.label_fr, en: row.label_en } : { fr: row.label_fr },
});

export function createReferenceData(database: Pick<Pool, "query" | "connect">, options: ReferenceDataOptions = {}): ReferenceData {
  const plainFetch = options.fetch ?? globalThis.fetch;
  const externalApis = options.externalApis ?? { record: () => {} };
  // Free public sources.
  const nafFetch = recordingFetch(plainFetch, externalApis, { provider: "insee-naf", costEur: () => 0 });
  const romeFetch = recordingFetch(plainFetch, externalApis, { provider: "rome-open-data", costEur: () => 0 });
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((line: string) => console.warn(line));

  /** Each source: the labels it gives, by kind, and the version they belong to. */
  const sources: Record<Source, () => Promise<{ entries: Partial<Record<Kind, ReferenceEntry[]>>; version: string }>> = {
    naf: async () => {
      const { sectors, subsectors } = await fetchNaf(nafFetch);
      return { entries: { sector: sectors, subsector: subsectors }, version: "NAF rév. 2" };
    },
    romeDomains: async () => {
      const { domains, version } = await fetchRomeDomains(romeFetch);
      return { entries: { domain: domains }, version: version ?? "ROME 4.0" };
    },
  };
  const KINDS: Record<Source, Kind> = { naf: "sector", romeDomains: "domain" };

  /** Asks `source` and replaces its labels, in one transaction; throws when it fails. */
  async function replace(source: Source): Promise<void> {
    const { entries, version } = await sources[source]();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const kinds = Object.keys(entries) as Kind[];
      await client.query(`DELETE FROM reference_label WHERE kind = ANY($1)`, [kinds]);
      for (const kind of kinds) {
        const list = entries[kind]!;
        await client.query(
          `INSERT INTO reference_label (kind, code, parent, label_fr, label_en, position, source_version)
           SELECT $1, code, parent, label_fr, label_en, position, $2
             FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[]) AS t(code, parent, label_fr, label_en, position)`,
          [
            kind,
            version,
            list.map((entry) => entry.code),
            list.map((entry) => entry.parent ?? null),
            list.map((entry) => entry.label.fr),
            list.map((entry) => entry.label.en ?? null),
            list.map((_, index) => index),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** When each source last failed on a read, so a read does not ask it again at once. */
  const failedAt: Partial<Record<Source, number>> = {};
  /** The fill in flight per source: reads made meanwhile wait for it rather than ask again. */
  const filling: Partial<Record<Source, Promise<void>>> = {};

  async function rows(): Promise<Row[]> {
    const { rows } = await database.query<Row>(`SELECT kind, code, parent, label_fr, label_en FROM reference_label ORDER BY kind, position`);
    return rows;
  }

  return {
    async read() {
      let kept = await rows();
      const missing = (Object.keys(sources) as Source[]).filter((source) => {
        if (kept.some((row) => row.kind === KINDS[source])) return false;
        const failed = failedAt[source];
        return failed === undefined || now().getTime() - failed >= RETRY_AFTER_MS;
      });
      if (missing.length > 0) {
        await Promise.all(
          missing.map((source) =>
            (filling[source] ??= replace(source)
              .then(() => void delete failedAt[source])
              .catch((error: unknown) => {
                failedAt[source] = now().getTime();
                warn(`[reference-data] ${source} could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
              })
              .finally(() => void delete filling[source])),
          ),
        );
        kept = await rows();
      }
      const of = (kind: Kind) => kept.filter((row) => row.kind === kind).map(entryOf);
      return { sectors: of("sector"), subsectors: of("subsector"), domains: of("domain") };
    },

    async refresh() {
      const report = {} as RefreshReport;
      for (const source of Object.keys(sources) as Source[]) {
        try {
          await replace(source);
          report[source] = "refreshed";
        } catch (error) {
          report[source] = { failed: error instanceof Error ? error.message : String(error) };
        }
      }
      return report;
    },
  };
}

/** Creates the reference data table. Safe to run repeatedly. */
export async function migrateReferenceData(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS reference_label (
      kind text NOT NULL CHECK (kind IN ('sector', 'subsector', 'domain')),
      code text NOT NULL,
      parent text,
      label_fr text NOT NULL,
      label_en text,
      position integer NOT NULL,
      source_version text NOT NULL,
      refreshed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, code)
    );
  `);
}
