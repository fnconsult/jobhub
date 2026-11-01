/**
 * Legal Text notices (#547, ADR-0062): what a Candidate is told of a substantial Legal Text Version.
 *
 * One deep module in front of Postgres. Callers get `createLegalTextNotices(database, deps)`:
 *  - `sendDue`: the worker's side. Each Candidate is emailed, in their Interface Language, of every substantial
 *    version of the CGU, the CGV or the privacy policy this build carries and not in effect yet: once per Candidate
 *    and per version. Only in Production (`production`), never from the Beta: the worker runs it once the Production
 *    deployment carrying the version starts, then daily. Running it again, or on two workers at once, sends nothing
 *    twice; an email that fails is sent on the next run, the others' all the same. A service email: it goes even
 *    without any marketing opt-in.
 *  - `privacyChange` and `dismissPrivacyChange`: the web app's side. From its effective date, a signed-in Candidate
 *    is shown once that the privacy policy changed (its latest substantial version in effect), with a link and
 *    « J'ai compris », no box and nothing blocked; once closed, never again for that version. A Candidate who signed
 *    up under that version is not shown it.
 *
 * Both kinds of rows are the Candidate's: in their Data export (`legalTextNoticesOf`), deleted with their account.
 */
import {
  legalNoticesDue,
  legalTextVersions,
  legalTextVersionUrl,
  parisDay,
  privacyChangeInEffect,
  type HelpLocale,
  type LegalTextId,
  type LegalTextVersion,
} from "@jobhub/help";
import { DEFAULT_LOCALE, isSupportedLocale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import type { Mailer } from "../auth";
import { routes } from "../routes";
import { legalTextNoticeEmail } from "./email";

/**
 * Whether this deployment sends the notices: Production only (#547), never the Beta. Production is
 * JOBHUB_TARGET=production, or a production build that names no target, as Nouveautés and the Playbooks' serving read
 * it (ADR-0021, ADR-0063); staging, the e2e suite and a developer's machine never send one.
 */
export function sendsLegalTextNotices(env: Record<string, string | undefined>): boolean {
  const target = env.JOBHUB_TARGET?.trim();
  return target ? target === "production" : env.NODE_ENV === "production";
}

export interface LegalTextNoticesDeps {
  mailer: Mailer;
  /** The web app's address, which the email's links lead to. */
  baseURL: string;
  /** Whether this is Production: only Production emails notices (#547), the Beta never does. */
  production: boolean;
  now?: () => Date;
  /** The Legal Text Versions, by language. Default: those this build carries. */
  written?: Record<HelpLocale, readonly LegalTextVersion[]>;
}

/** The privacy policy's change a Candidate is shown: its version (its effective date) and its permanent address. */
export interface PrivacyChange {
  version: string;
  url: string;
}

export interface LegalTextNotices {
  /** Emails each Candidate the notices due and not sent to them yet. How many went, and how many could not: those are left to the next run. */
  sendDue(): Promise<{ emails: number; failed: number }>;
  /** The privacy policy's change to show the Candidate now; null when there is none, or they closed it. */
  privacyChange(candidateId: string): Promise<PrivacyChange | null>;
  /** The Candidate closed the change `version` (« J'ai compris »). Only the one shown is closed; anything else is ignored. */
  dismissPrivacyChange(candidateId: string, version: string): Promise<void>;
}

/** What the Data export holds of a Candidate's Legal Text notices. */
export interface ExportedLegalTextNotices {
  /** The notice emails sent to them, newest first: the text and version each told of. */
  emailed: { text: LegalTextId; version: string; sentAt: Date }[];
  /** The privacy policy's changes they closed, newest first. */
  privacyChangesSeen: { version: string; seenAt: Date }[];
}

export function createLegalTextNotices(database: Pool, deps: LegalTextNoticesDeps): LegalTextNotices {
  const now = deps.now ?? (() => new Date());
  const written = (locale: HelpLocale) => deps.written?.[locale] ?? legalTextVersions(locale);
  const link = (path: string, language: string) => new URL(`${path}?lang=${language}`, deps.baseURL).toString();

  /** The version of `text` in `language`, falling back to the French, the binding text. */
  function inLanguage(version: LegalTextVersion, language: HelpLocale): LegalTextVersion {
    return written(language).find((entry) => entry.text === version.text && entry.effective === version.effective) ?? version;
  }

  /**
   * Claims the Candidate's notice of `version` and emails it, in one transaction: a second worker waits on the claim,
   * then finds it taken; a failed email gives it back. Whether it was sent now.
   */
  async function notify(candidate: { id: string; email: string; interfaceLanguage: string | null }, version: LegalTextVersion, sentAt: Date): Promise<boolean> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `INSERT INTO legal_text_notice (candidate_id, text, version, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [candidate.id, version.text, version.effective, sentAt],
      );
      if (rowCount) {
        const language = isSupportedLocale(candidate.interfaceLanguage) ? candidate.interfaceLanguage : DEFAULT_LOCALE;
        const email = legalTextNoticeEmail(
          { version: inLanguage(version, language), versionUrl: link(legalTextVersionUrl(version.text, version.effective), language), historyUrl: link(routes.legalVersions(version.text), language) },
          language,
        );
        await deps.mailer.send({ to: candidate.email, ...email });
      }
      await client.query("COMMIT");
      return Boolean(rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async sendDue() {
      if (!deps.production) return { emails: 0, failed: 0 };
      const at = now();
      let emails = 0;
      let failed = 0;
      for (const version of legalNoticesDue(parisDay(at), written("fr"))) {
        const { rows } = await database.query<{ id: string; email: string; interfaceLanguage: string | null }>(
          `SELECT c.id, c.email, c."interfaceLanguage" FROM candidate c
            WHERE c."emailVerified"
              AND NOT EXISTS (SELECT 1 FROM legal_text_notice n WHERE n.candidate_id = c.id AND n.text = $1 AND n.version = $2)
            ORDER BY c."createdAt", c.id`,
          [version.text, version.effective],
        );
        for (const candidate of rows) {
          try {
            if (await notify(candidate, version, at)) emails += 1;
          } catch {
            failed += 1;
          }
        }
      }
      return { emails, failed };
    },

    async privacyChange(candidateId) {
      const change = privacyChangeInEffect(parisDay(now()), written("fr"));
      if (!change) return null;
      const { rows } = await database.query<{ shown: boolean }>(
        `SELECT NOT EXISTS (SELECT 1 FROM privacy_change_seen s WHERE s.candidate_id = c.id AND s.version = $2)
                AND (c."createdAt" AT TIME ZONE 'Europe/Paris')::date < $2::date AS shown
           FROM candidate c WHERE c.id = $1`,
        [candidateId, change.effective],
      );
      return rows[0]?.shown ? { version: change.effective, url: legalTextVersionUrl("confidentialite", change.effective) } : null;
    },

    async dismissPrivacyChange(candidateId, version) {
      if (privacyChangeInEffect(parisDay(now()), written("fr"))?.effective !== version) return;
      await database.query(`INSERT INTO privacy_change_seen (candidate_id, version, seen_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [candidateId, version, now()]);
    },
  };
}

/** The Candidate's Legal Text notices, as their Data export holds them. */
export async function legalTextNoticesOf(database: Pick<Pool, "query">, candidateId: string): Promise<ExportedLegalTextNotices> {
  const [emailed, seen] = await Promise.all([
    database.query<ExportedLegalTextNotices["emailed"][number]>(
      `SELECT text, version, sent_at AS "sentAt" FROM legal_text_notice WHERE candidate_id = $1 ORDER BY sent_at DESC, text, version`,
      [candidateId],
    ),
    database.query<ExportedLegalTextNotices["privacyChangesSeen"][number]>(
      `SELECT version, seen_at AS "seenAt" FROM privacy_change_seen WHERE candidate_id = $1 ORDER BY seen_at DESC, version`,
      [candidateId],
    ),
  ]);
  return { emailed: emailed.rows, privacyChangesSeen: seen.rows };
}

/** Creates or upgrades the Legal Text notices' tables. Run after Candidate accounts. Safe to run repeatedly. */
export async function migrateLegalTextNotices(database: Pool): Promise<void> {
  await database.query(`
    -- The notice emails of substantial Legal Text Versions sent (#547): one per Candidate and per version, kept with the account.
    CREATE TABLE IF NOT EXISTS legal_text_notice (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      -- The Legal Text and the version (its effective date, YYYY-MM-DD) the email told of.
      text text NOT NULL,
      version text NOT NULL,
      sent_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, text, version)
    );
    CREATE INDEX IF NOT EXISTS legal_text_notice_version_idx ON legal_text_notice (text, version);
    -- The substantial changes to the privacy policy a Candidate closed (« J'ai compris »): one per Candidate and per version.
    CREATE TABLE IF NOT EXISTS privacy_change_seen (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      version text NOT NULL,
      seen_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, version)
    );
  `);
}
