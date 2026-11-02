/**
 * The Nouveautés email (#566, ADR-0063, CONTEXT.md): what a Candidate is told of a Release Note marked `announce: true`.
 *
 * One deep module in front of Postgres. Callers get `createNouveautesEmails(database, deps)`:
 *  - the Candidate's side, in Mon compte's Préférences: `setting` (subscribed or not, and since when) and `subscribe` /
 *    `unsubscribe`. Never ticked by default, for a new Candidate as for one who existed before; ticking keeps the date of
 *    the consent (GDPR art. 6(1)(a)), unticking deletes it. Only Candidates: no form on the public Nouveautés page.
 *  - the email's side: `unsubscribeByToken`, for the unsubscribe link and the one-click List-Unsubscribe header (RFC
 *    8058), with no sign-in, as for the Job Digest. The token names one Candidate's subscription; subscribing again
 *    gives a new one.
 *  - the worker's side: `sendDue`. Each subscribed Candidate with a verified address is emailed, in their Interface
 *    Language, the oldest announced Release Note they were not sent, of a Version Production serves or served: the
 *    one it serves now, or an earlier one dated on or after the day they subscribed. At most one email per Candidate
 *    every 7 days (Paris days), so a second note of the same week waits for the next; once per Version. Only in
 *    Production (`production`), never from the Beta. Each email is claimed before it is sent: running it again, or on
 *    two workers at once, sends nothing twice; an email that fails gives its claim back and is sent on the next run.
 *
 * The email carries no image and no tracked link: every link leads straight to Jobbbox (apps/web/src/emails). Brevo
 * has no per-message switch for its open and click tracking: it must be off on the account (docs/privacy/register.md).
 *
 * Both tables are the Candidate's: in their Data export (`nouveautesEmailOf`), deleted with their account.
 */
import { addDays, compareVersions, nouveautes, parisDay, releaseNotes, type HelpLocale, type ReleaseNote } from "@jobhub/help";
import { DEFAULT_LOCALE, isSupportedLocale } from "@jobhub/shared/i18n";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Mailer } from "../auth";
import { routes } from "../routes";
import { nouveautesEmail } from "./email";

/** No more than one Nouveautés email per Candidate in this long. */
export const MIN_INTERVAL_DAYS = 7;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface NouveautesEmailsDeps {
  mailer: Mailer;
  /** The web app's address, which the email's links lead to. */
  baseURL: string;
  /** Whether this is Production: only Production sends the Nouveautés email, never the Beta. */
  production: boolean;
  /** The Version this deployment serves; notes of a later Version are never sent. Null: none known, nothing is sent. */
  version: string | null;
  now?: () => Date;
  /** Where an email that could not be sent is told. Default: console.error. */
  logError?: (line: string, error: unknown) => void;
  /** The Release Notes, by language. Default: those this build carries. */
  written?: Record<HelpLocale, readonly ReleaseNote[]>;
}

/** The Candidate's choice in Mon compte: subscribed since `subscribedAt`, or not (null). */
export interface NouveautesEmailSetting {
  subscribed: boolean;
  subscribedAt: Date | null;
}

/** What the Data export holds of a Candidate's Nouveautés email. */
export interface ExportedNouveautesEmail extends NouveautesEmailSetting {
  /** The Nouveautés emails sent to them, newest first: the Version each told of. */
  sent: { version: string; sentAt: Date }[];
}

export interface NouveautesEmails {
  setting(candidateId: string): Promise<NouveautesEmailSetting>;
  /** Ticks the box: the consent's date is now, or stays the first one when already ticked. */
  subscribe(candidateId: string): Promise<NouveautesEmailSetting>;
  /** Unticks it: the consent and its date are deleted. */
  unsubscribe(candidateId: string): Promise<NouveautesEmailSetting>;
  /** Unsubscribes with the token of an email's link. False when the token names no subscription (any more). */
  unsubscribeByToken(token: string): Promise<boolean>;
  /** Emails each subscribed Candidate the note due to them. How many went, and how many could not: those are left to the next run. */
  sendDue(): Promise<{ emails: number; failed: number }>;
}

/** An unguessable token for the unsubscribe link (RFC 8058). */
const newToken = () => randomBytes(32).toString("base64url");

/** The page an email's unsubscribe link opens, in the email's language (it asks before unsubscribing). */
export function unsubscribePageURL(baseURL: string, token: string, language: string): string {
  return new URL(`${routes.nouveautesEmailUnsubscribe}?${new URLSearchParams({ token, lang: language })}`, baseURL).toString();
}

/** The one-click endpoint of the List-Unsubscribe header (RFC 8058): a POST unsubscribes at once. */
export function oneClickUnsubscribeURL(baseURL: string, token: string): string {
  return new URL(`/api/nouveautes-email/unsubscribe?${new URLSearchParams({ token })}`, baseURL).toString();
}

/**
 * The announced Release Notes a Production serving `version` has published, oldest first: those of `version` and before.
 * Production only: the Beta's next Version is not published yet.
 */
export function announcedNotes(notes: readonly ReleaseNote[], version: string | null): ReleaseNote[] {
  if (!version) return [];
  return nouveautes(notes, { version, beta: false })
    .published.filter((note) => note.announce)
    .sort((a, b) => compareVersions(a.version, b.version));
}

interface SubscriberRow {
  id: string;
  email: string;
  interfaceLanguage: string | null;
  subscribed_at: Date;
  unsubscribe_token: string;
  sent: string[];
  last_sent_at: Date | null;
}

export function createNouveautesEmails(database: Pool, deps: NouveautesEmailsDeps): NouveautesEmails {
  const now = deps.now ?? (() => new Date());
  const written = (locale: HelpLocale) => deps.written?.[locale] ?? releaseNotes(locale);
  const logError = deps.logError ?? ((line: string, error: unknown) => console.error(line, error));

  async function setting(candidateId: string): Promise<NouveautesEmailSetting> {
    const { rows } = await database.query<{ subscribed_at: Date }>(`SELECT subscribed_at FROM nouveautes_email_subscription WHERE candidate_id = $1`, [candidateId]);
    const subscribedAt = rows[0]?.subscribed_at ?? null;
    return { subscribed: subscribedAt !== null, subscribedAt };
  }

  /**
   * The note due to `subscriber` now, or null: the oldest announced one they were not sent, the served Version's or one
   * dated since they subscribed; none within MIN_INTERVAL_DAYS Paris days of the last one.
   */
  function dueNote(subscriber: Pick<SubscriberRow, "subscribed_at" | "sent" | "last_sent_at">, announced: ReleaseNote[], at: Date): ReleaseNote | null {
    if (subscriber.last_sent_at && parisDay(at) < addDays(parisDay(subscriber.last_sent_at), MIN_INTERVAL_DAYS)) return null;
    const since = parisDay(subscriber.subscribed_at);
    return announced.find((note) => (note.version === deps.version || note.date >= since) && !subscriber.sent.includes(note.version)) ?? null;
  }

  /**
   * Claims the Candidate's email of `note`, then sends it. The claim is made in a transaction that locks the
   * subscription, so a second worker waits, then finds the week's email taken; it is committed before the email goes,
   * so an email is never sent twice, and given back when the email fails. Whether it was sent now.
   */
  async function send(candidateId: string, note: ReleaseNote, announced: ReleaseNote[], at: Date): Promise<boolean> {
    const client = await database.connect();
    let subscriber: SubscriberRow | undefined;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<SubscriberRow>(
        `SELECT c.id, c.email, c."interfaceLanguage", s.subscribed_at, s.unsubscribe_token,
                coalesce((SELECT array_agg(version) FROM nouveautes_email_sent n WHERE n.candidate_id = c.id), '{}') AS sent,
                (SELECT max(sent_at) FROM nouveautes_email_sent n WHERE n.candidate_id = c.id) AS last_sent_at
           FROM nouveautes_email_subscription s JOIN candidate c ON c.id = s.candidate_id
          WHERE s.candidate_id = $1 AND c."emailVerified"
            FOR UPDATE OF s`,
        [candidateId],
      );
      // Still subscribed, and still due this note: another worker may have sent this week's email meanwhile.
      subscriber = rows[0] && dueNote(rows[0], announced, at)?.version === note.version ? rows[0] : undefined;
      if (subscriber) await client.query(`INSERT INTO nouveautes_email_sent (candidate_id, version, sent_at) VALUES ($1, $2, $3)`, [candidateId, note.version, at]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!subscriber) return false;
    try {
      // The Release Note in their Interface Language; the French one, and a French email, when it has none.
      const own = isSupportedLocale(subscriber.interfaceLanguage) ? subscriber.interfaceLanguage : DEFAULT_LOCALE;
      const translated = written(own).find((entry) => entry.version === note.version);
      const language: HelpLocale = translated ? own : "fr";
      const email = nouveautesEmail(
        {
          note: translated ?? note,
          noteUrl: new URL(`${routes.nouveautesVersion(note.version)}?lang=${language}`, deps.baseURL).toString(),
          unsubscribeUrl: unsubscribePageURL(deps.baseURL, subscriber.unsubscribe_token, language),
        },
        language,
      );
      await deps.mailer.send({
        to: subscriber.email,
        ...email,
        headers: { "List-Unsubscribe": `<${oneClickUnsubscribeURL(deps.baseURL, subscriber.unsubscribe_token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      return true;
    } catch (error) {
      await database.query(`DELETE FROM nouveautes_email_sent WHERE candidate_id = $1 AND version = $2`, [candidateId, note.version]);
      throw error;
    }
  }

  return {
    setting,

    async subscribe(candidateId) {
      await database.query(
        `INSERT INTO nouveautes_email_subscription (candidate_id, subscribed_at, unsubscribe_token) VALUES ($1, $2, $3) ON CONFLICT (candidate_id) DO NOTHING`,
        [candidateId, now(), newToken()],
      );
      return setting(candidateId);
    },

    async unsubscribe(candidateId) {
      await database.query(`DELETE FROM nouveautes_email_subscription WHERE candidate_id = $1`, [candidateId]);
      return setting(candidateId);
    },

    async unsubscribeByToken(token) {
      if (!TOKEN.test(token)) return false;
      const { rowCount } = await database.query(`DELETE FROM nouveautes_email_subscription WHERE unsubscribe_token = $1`, [token]);
      return (rowCount ?? 0) > 0;
    },

    async sendDue() {
      if (!deps.production) return { emails: 0, failed: 0 };
      const announced = announcedNotes(written("fr"), deps.version);
      if (announced.length === 0) return { emails: 0, failed: 0 };
      const at = now();
      const { rows } = await database.query<SubscriberRow>(
        `SELECT c.id, s.subscribed_at,
                coalesce((SELECT array_agg(version) FROM nouveautes_email_sent n WHERE n.candidate_id = c.id), '{}') AS sent,
                (SELECT max(sent_at) FROM nouveautes_email_sent n WHERE n.candidate_id = c.id) AS last_sent_at
           FROM nouveautes_email_subscription s JOIN candidate c ON c.id = s.candidate_id
          WHERE c."emailVerified"
          ORDER BY s.subscribed_at, c.id`,
      );
      let emails = 0;
      let failed = 0;
      for (const subscriber of rows) {
        const note = dueNote(subscriber, announced, at);
        if (!note) continue;
        try {
          if (await send(subscriber.id, note, announced, at)) emails += 1;
        } catch (error) {
          failed += 1;
          logError(`[nouveautes-emails] the email of ${note.version} could not be sent to Candidate ${subscriber.id}`, error);
        }
      }
      return { emails, failed };
    },
  };
}

/** The Candidate's Nouveautés email, as their Data export holds it: the choice, its date and the emails sent (no unsubscribe token). */
export async function nouveautesEmailOf(database: Pick<Pool, "query">, candidateId: string): Promise<ExportedNouveautesEmail> {
  const [subscription, sent] = await Promise.all([
    database.query<{ subscribedAt: Date }>(`SELECT subscribed_at AS "subscribedAt" FROM nouveautes_email_subscription WHERE candidate_id = $1`, [candidateId]),
    database.query<ExportedNouveautesEmail["sent"][number]>(`SELECT version, sent_at AS "sentAt" FROM nouveautes_email_sent WHERE candidate_id = $1 ORDER BY sent_at DESC, version`, [candidateId]),
  ]);
  const subscribedAt = subscription.rows[0]?.subscribedAt ?? null;
  return { subscribed: subscribedAt !== null, subscribedAt, sent: sent.rows };
}

/** Creates or upgrades the Nouveautés email's tables. Run after Candidate accounts. Safe to run repeatedly. */
export async function migrateNouveautesEmails(database: Pool): Promise<void> {
  await database.query(`
    -- The Candidates who ticked « Recevoir un e-mail quand Jobbbox annonce une nouveauté » (#566): the consent's date and
    -- the unsubscribe link's token. Unticking, or the link, deletes the row.
    CREATE TABLE IF NOT EXISTS nouveautes_email_subscription (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      subscribed_at timestamptz NOT NULL,
      unsubscribe_token text NOT NULL UNIQUE
    );
    -- The Nouveautés emails sent: one per Candidate and per Version (X.Y.Z), kept with the account.
    CREATE TABLE IF NOT EXISTS nouveautes_email_sent (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      version text NOT NULL,
      sent_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, version)
    );
  `);
}
