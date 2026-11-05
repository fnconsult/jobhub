/**
 * Follow-ups: when an Application has stayed "Postulée" or "Relancée" unchanged
 * past the Candidate's Follow-up Delay, the AI Coach proposes a Follow-up email
 * draft as an Action Card on the Application, and tells the Candidate by email.
 *
 * One deep module in front of Postgres. Callers get
 * `createFollowUps(database, { actionCards, applications, mailer, appUrl, ai?, now? })`:
 *  - `proposeDue(now)` — for the worker's schedule: proposes every Follow-up
 *    (or "Abandonnée" suggestion) now due, and emails each Candidate concerned.
 *    Safe to run as often as wanted: a card is proposed once per wait.
 *  - `onAccept` — the Action Cards' handlers: accepting a Follow-up means the
 *    Candidate sent it themselves, and moves the Application to "Relancée";
 *    accepting the suggestion moves it to "Abandonnée".
 *  - `delays` / `setDelays` — the Candidate's Follow-up Delay.
 *  - `notices(candidateId)` — the in-app notice: the Candidate's Applications
 *    with a Follow-up or suggestion waiting for them.
 *  - `sentOf` / `markSent` / `unmarkSent` — a Follow-up marked as sent from a Coach proposal (#716, ADR-0077): how
 *    many were sent and their version; marking one from the version seen (moved on since: a `conflict`), as accepting
 *    a Follow-up card does, the status keeping its Origin and a pending Follow-up withdrawn; « Annuler » puts the state
 *    before back while nothing moved on since. Each is one transaction, the Application's row locked (#771): the status
 *    and the Follow-up rows change together or not at all, and a concurrent second mark finds the version moved on.
 *    Each Follow-up sent is numbered (1, 2): the table refuses a third, and the same number twice.
 *  - `followUpCardApplies(card, status)` — whether a pending card still applies:
 *    once the Application leaves "Postulée"/"Relancée", its Follow-up and
 *    suggestion are withdrawn (hidden, and accepting them changes nothing).
 *
 * Rules kept here:
 *  - The wait is counted in French working days from the last change: the
 *    Application Status, or the last Follow-up sent.
 *  - Default Follow-up Delay: 7 working days after "Postulée", then 10 more.
 *    Two Follow-ups at most; when the second stays unanswered as long, the AI
 *    Coach suggests "Abandonnée" instead. The status itself only ever changes
 *    when the Candidate accepts a card.
 *  - Drafts only (ADR-0005): the Follow-up is never sent to the employer.
 *    The only email is the notice to the Candidate.
 * A Follow-up card keeps the Provenance of its draft's writing (#336); an "Abandonnée"
 * suggestion, worded by Jobbbox, keeps none.
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results (but for `onAccept`, which throws so the card stays pending).
 */
import type { AiLayer } from "@jobhub/ai";
import { jobOfferLanguage, type ApplicationStatus, type DocumentLanguage } from "@jobhub/shared";
import { createI18n, DEFAULT_LOCALE, isSupportedLocale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import * as z from "zod";
import type { AcceptHandler, ActionCard, ActionCards } from "../action-cards";
import type { Applications } from "../applications";
import { readOrigin, type Origin } from "../origin";
import type { Mailer } from "../auth";
import { routes } from "../routes";
import { followUpEmail } from "./email";
import { fieldErrors, type FieldError } from "../validation";
import type { TaskPlaybookReader } from "../task-playbooks";
import { followUpDraft } from "./draft";
import { addWorkingDays, frenchDate } from "./working-days";

/** The kind of Action Card a Follow-up is proposed as. */
export const FOLLOW_UP_CARD = "follow_up";
/** The kind of Action Card suggesting "Abandonnée" after the last Follow-up went unanswered. */
export const ABANDON_CARD = "abandon_suggestion";

/** Follow-ups proposed per Application before the AI Coach suggests "Abandonnée". */
export const MAX_FOLLOW_UPS = 2;

/** How long an Application must stay unchanged before a Follow-up is proposed, in working days. */
export interface FollowUpDelays {
  /** After "Postulée". */
  afterApplied: number;
  /** After each Follow-up sent (or "Relancée" set). */
  afterFollowUp: number;
}

export const DEFAULT_FOLLOW_UP_DELAYS: FollowUpDelays = { afterApplied: 7, afterFollowUp: 10 };
export const MAX_FOLLOW_UP_DELAY = 60;

/** What a Follow-up or suggestion card carries. */
export interface FollowUpPayload {
  /** When the wait it ends started (ISO 8601): the card is proposed once per wait. */
  since: string;
  jobTitle: string;
  /** The Follow-up email draft (Follow-up cards only), in the Application's Document Language. */
  subject?: string;
  text?: string;
}

/** One Application with a Follow-up or "Abandonnée" suggestion waiting for the Candidate. */
export interface FollowUpNotice {
  applicationId: string;
  jobTitle: string;
  kind: typeof FOLLOW_UP_CARD | typeof ABANDON_CARD;
}

export type SetDelaysResult = { ok: true; delays: FollowUpDelays } | { ok: false; errors: FieldError[] };

/** The Follow-ups sent on an Application (#716): how many (a « Relancée » set by hand counts), its status, and their version. */
export interface FollowUpsSent {
  count: number;
  status: ApplicationStatus;
  /** Moves with the Application Status and with every Follow-up marked as sent. */
  version: string;
}

/**
 * Marking a Follow-up as sent from a Coach proposal (#716): `conflict` when the version moved on, `not_waiting` when the
 * Application is not at « Postulée » or « Relancée », `limit` once MAX_FOLLOW_UPS were sent. `undo`: what `unmarkSent` needs.
 */
export type MarkSentResult = { ok: true; undo: unknown } | { ok: false; error: "not_found" | "conflict" | "not_waiting" | "limit" };
export type UnmarkSentResult = { ok: true } | { ok: false; error: "not_found" | "conflict" };

export interface FollowUps {
  proposeDue(now: Date): Promise<void>;
  onAccept: Record<string, AcceptHandler>;
  delays(candidateId: string): Promise<FollowUpDelays>;
  /** `input`: { afterApplied, afterFollowUp }, whole working days from 1 to MAX_FOLLOW_UP_DELAY. */
  setDelays(candidateId: string, input: unknown): Promise<SetDelaysResult>;
  notices(candidateId: string): Promise<FollowUpNotice[]>;
  /** The Follow-ups sent on the Application (#716); null when it is not the Candidate's. */
  sentOf(candidateId: string, applicationId: string): Promise<FollowUpsSent | null>;
  /** Marks a Follow-up as sent from a Coach proposal the Candidate applied (#716), from the version it saw. */
  markSent(candidateId: string, applicationId: string, options: { version: string; origin: Origin }): Promise<MarkSentResult>;
  /** « Annuler » (#716): puts back the state before `markSent`, from what it gave back, while nothing moved on since. */
  unmarkSent(candidateId: string, applicationId: string, undo: unknown): Promise<UnmarkSentResult>;
}

export interface FollowUpsDeps {
  /** Where the cards are proposed (without handlers: proposing only). */
  actionCards: Pick<ActionCards, "propose" | "pending" | "dismissed" | "pendingOfKinds" | "withdraw">;
  applications: Pick<Applications, "change">;
  /** Delivers the notice email to the Candidate. */
  mailer: Mailer;
  /** Public origin of the web app, for the link in the notice email. */
  appUrl: string;
  /** Optional: without it (or when it fails), the Follow-up is drafted from a plain template. */
  ai?: AiLayer;
  /** The "follow-up" task Playbook's served version (ADR-0026); without it, its built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
  /** The clock a Follow-up is marked as sent by. Defaults to the real time. */
  now?: () => Date;
}

const delay = z.coerce.number().int().min(1).max(MAX_FOLLOW_UP_DELAY);
const delaysSchema = z.object({ afterApplied: delay, afterFollowUp: delay });

const KINDS = [FOLLOW_UP_CARD, ABANDON_CARD] as const;

/** The statuses an Application waits in for a Follow-up: "Postulée" and "Relancée". */
const WAITING_STATUSES: readonly ApplicationStatus[] = ["applied", "followed_up"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The Application Status's version, as the Applications module gives it (#715). */
const STATUS_VERSION = "(extract(epoch FROM a.status_changed_at) * 1000000)::bigint::text";

/**
 * Whether a card still applies to its Application at this status. A Follow-up or
 * "Abandonnée" suggestion only ends a wait at "Postulée" or "Relancée": once the
 * Candidate moves the Application on (e.g. "Entretien"), it is withdrawn — not shown,
 * not in the notice, and accepting it changes nothing. Other kinds of card always apply.
 */
export function followUpCardApplies(card: Pick<ActionCard, "kind">, status: ApplicationStatus): boolean {
  return !(KINDS as readonly string[]).includes(card.kind) || WAITING_STATUSES.includes(status);
}

interface WaitingRow {
  id: string;
  candidate_id: string;
  status: ApplicationStatus;
  status_changed_at: Date;
  document_language: DocumentLanguage | null;
  title: string;
  employer: string | null;
  content: string;
  email: string;
  interface_language: string | null;
  after_applied: number | null;
  after_follow_up: number | null;
  sent: number;
  last_sent_at: Date | null;
}

/** What « Annuler » needs after a Follow-up marked as sent from a Coach proposal (#716). */
const unmarkSchema = z.object({
  sentIds: z.array(z.string()),
  status: z.enum(WAITING_STATUSES as unknown as ["applied", "followed_up"]),
  origin: z.unknown(),
  statusVersion: z.string(),
  version: z.string(),
});

/** A "Relancée" set by hand (after the last Follow-up marked as sent, if any) counts as one sent. */
const setByHand = (row: { status: ApplicationStatus; status_changed_at: Date; last_sent_at: Date | null }) =>
  row.status === "followed_up" && (!row.last_sent_at || row.status_changed_at > row.last_sent_at);

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505";
const isCheckViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23514";

function payloadOf(card: Pick<ActionCard, "payload">): Partial<FollowUpPayload> {
  return (card.payload ?? {}) as Partial<FollowUpPayload>;
}

export function createFollowUps(database: Pool, deps: FollowUpsDeps): FollowUps {
  const now = deps.now ?? (() => new Date());
  async function delays(candidateId: string): Promise<FollowUpDelays> {
    const { rows } = await database.query<{ after_applied: number; after_follow_up: number }>(
      `SELECT after_applied, after_follow_up FROM follow_up_delay WHERE candidate_id = $1`,
      [candidateId],
    );
    return rows[0] ? { afterApplied: rows[0].after_applied, afterFollowUp: rows[0].after_follow_up } : DEFAULT_FOLLOW_UP_DELAYS;
  }

  /** Proposes the card that ends this Application's wait, unless it is pending or was dismissed. Returns whether it did. */
  async function propose(row: WaitingRow, now: Date): Promise<boolean> {
    const since = row.last_sent_at && row.last_sent_at > row.status_changed_at ? row.last_sent_at : row.status_changed_at;
    const wait =
      row.status === "applied"
        ? (row.after_applied ?? DEFAULT_FOLLOW_UP_DELAYS.afterApplied)
        : (row.after_follow_up ?? DEFAULT_FOLLOW_UP_DELAYS.afterFollowUp);
    if (frenchDate(now) < addWorkingDays(since, wait)) return false;

    const focus = { kind: "application", id: row.id } as const;
    const [pending, dismissed] = await Promise.all([deps.actionCards.pending(row.candidate_id, focus), deps.actionCards.dismissed(row.candidate_id, focus)]);
    if (pending.some((card) => (KINDS as readonly string[]).includes(card.kind))) return false;
    const byHand = setByHand(row) ? 1 : 0;
    const sent = row.sent + byHand;
    const kind = sent >= MAX_FOLLOW_UPS ? ABANDON_CARD : FOLLOW_UP_CARD;
    if (dismissed.some((card) => card.kind === kind && payloadOf(card).since === since.toISOString())) return false;

    const { t } = createI18n(row.interface_language);
    const payload: FollowUpPayload = { since: since.toISOString(), jobTitle: row.title };
    if (kind === FOLLOW_UP_CARD) {
      const language = row.document_language ?? jobOfferLanguage({ title: row.title, content: row.content });
      const { draft, provenance } = await followUpDraft({ ai: deps.ai, candidateId: row.candidate_id, language, jobOffer: row, followUpNumber: sent + 1, taskPlaybooks: deps.taskPlaybooks });
      Object.assign(payload, draft);
      await deps.actionCards.propose(row.candidate_id, { kind, focus, payload, provenance, title: t("followUps.cardTitle", { title: row.title }), body: draft.text });
    } else {
      await deps.actionCards.propose(row.candidate_id, {
        kind,
        focus,
        payload,
        title: t("followUps.abandonTitle", { title: row.title }),
        body: t("followUps.abandonBody", { count: sent }),
      });
    }
    const email = followUpEmail(
      kind === FOLLOW_UP_CARD ? "followUp" : "abandoned",
      {
        jobTitle: row.title,
        applicationUrl: new URL(routes.application(row.id), deps.appUrl).toString(),
        settingsUrl: new URL(routes.accountFollowUps, deps.appUrl).toString(),
      },
      isSupportedLocale(row.interface_language) ? row.interface_language : DEFAULT_LOCALE,
    );
    try {
      await deps.mailer.send({ to: row.email, ...email });
    } catch (error) {
      // The card is on the Application all the same: the email is only a notice.
      console.warn("[follow-ups] the notice email could not be sent:", error instanceof Error ? error.message : error);
    }
    return true;
  }

  /** Throws (the card stays pending) unless the card still applies to its Application. */
  async function waitingStatus(card: ActionCard, candidateId: string) {
    if (card.focus.kind !== "application") throw new Error("not a card on an Application");
    const { rows } = await database.query<{ status: ApplicationStatus; status_changed_at: Date; last_sent_at: Date | null }>(
      `SELECT a.status, a.status_changed_at, (SELECT max(sent_at) FROM follow_up_sent s WHERE s.application_id = a.id) AS last_sent_at
         FROM application a WHERE a.id = $1 AND a.candidate_id = $2`,
      [card.focus.id, candidateId],
    );
    const before = rows[0];
    if (!before) throw new Error("no such Application");
    if (!followUpCardApplies(card, before.status)) throw new Error(`the Application has moved on to "${before.status}"`);
    return before;
  }

  /**
   * Records a Follow-up sent on the Application, once its status is "Relancée": a "Relancée" set by hand before it still
   * counts as one sent. Each row takes the next number (1, then 2): the table's constraint refuses a third, and two
   * concurrent records of the same number (#771). Gives back the rows it added.
   */
  async function recordSent(
    client: Queryable,
    applicationId: string,
    before: { status: ApplicationStatus; status_changed_at: Date; last_sent_at: Date | null },
  ): Promise<string[]> {
    const ids: string[] = [];
    const next = `(SELECT coalesce(max(number), 0) + 1 FROM follow_up_sent WHERE application_id = $1)`;
    if (setByHand(before)) {
      const { rows } = await client.query<{ id: string }>(`INSERT INTO follow_up_sent (application_id, sent_at, number) VALUES ($1, $2, ${next}) RETURNING id`, [
        applicationId,
        before.status_changed_at,
      ]);
      ids.push(rows[0]!.id);
    }
    // Never before the status change it caused, so it is not taken for a "Relancée" set by hand.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO follow_up_sent (application_id, sent_at, number) SELECT id, greatest($2::timestamptz, status_changed_at), ${next} FROM application WHERE id = $1 RETURNING id`,
      [applicationId, now()],
    );
    ids.push(rows[0]!.id);
    return ids;
  }

  /**
   * The Application's status and Follow-ups sent, for the Candidate only. `lock`: on a transaction's client, the
   * Application's row is locked first, so a concurrent mark or unmark waits and then reads what this one wrote (#771).
   */
  async function sentState(candidateId: string, applicationId: string, client: Queryable = database, lock = false) {
    if (!UUID.test(applicationId)) return null;
    if (lock) {
      const { rows } = await client.query(`SELECT 1 FROM application WHERE id = $1 AND candidate_id = $2 FOR UPDATE`, [applicationId, candidateId]);
      if (rows.length === 0) return null;
    }
    const { rows } = await client.query<{ status: ApplicationStatus; status_changed_at: Date; last_sent_at: Date | null; sent: number; version: string; status_version: string; status_origin: unknown }>(
      `SELECT a.status, a.status_changed_at, s.last_sent_at, s.sent, a.status_origin, ${STATUS_VERSION} AS status_version,
              ${STATUS_VERSION} || ':' || s.sent || ':' || coalesce((extract(epoch FROM s.last_sent_at) * 1000000)::bigint::text, '') AS version
         FROM application a,
              LATERAL (SELECT count(*)::int AS sent, max(sent_at) AS last_sent_at FROM follow_up_sent WHERE application_id = a.id) s
        WHERE a.id = $1 AND a.candidate_id = $2`,
      [applicationId, candidateId],
    );
    const row = rows[0];
    return row ? { ...row, count: row.sent + (setByHand(row) ? 1 : 0) } : null;
  }

  async function moveTo(card: ActionCard, candidateId: string, status: ApplicationStatus) {
    const changed = await deps.applications.change(candidateId, card.focus.id, { status });
    if (!changed.ok) throw new Error("the Application could not be changed");
  }

  return {
    async proposeDue(now) {
      const { rows } = await database.query<WaitingRow>(
        `SELECT a.id, a.candidate_id, a.status, a.status_changed_at, a.document_language,
                o.title, o.employer, o.content, c.email, c."interfaceLanguage" AS interface_language,
                d.after_applied, d.after_follow_up,
                (SELECT count(*)::int FROM follow_up_sent s WHERE s.application_id = a.id) AS sent,
                (SELECT max(sent_at) FROM follow_up_sent s WHERE s.application_id = a.id) AS last_sent_at
           FROM application a
           JOIN job_offer o ON o.id = a.job_offer_id
           JOIN candidate c ON c.id = a.candidate_id
           LEFT JOIN follow_up_delay d ON d.candidate_id = a.candidate_id
          WHERE a.status = ANY($1::text[])
          ORDER BY a.status_changed_at, a.id`,
        [WAITING_STATUSES],
      );
      for (const row of rows) {
        try {
          await propose(row, now);
        } catch (error) {
          // One Application that fails never holds up the others.
          console.warn(`[follow-ups] application ${row.id}:`, error instanceof Error ? error.message : error);
        }
      }
    },

    onAccept: {
      [FOLLOW_UP_CARD]: async (card, candidateId) => {
        const before = await waitingStatus(card, candidateId);
        await moveTo(card, candidateId, "followed_up");
        await recordSent(database, card.focus.id, before);
      },
      [ABANDON_CARD]: async (card, candidateId) => {
        await waitingStatus(card, candidateId);
        await moveTo(card, candidateId, "abandoned");
      },
    },

    delays,

    async sentOf(candidateId, applicationId) {
      const state = await sentState(candidateId, applicationId);
      return state ? { count: state.count, status: state.status, version: state.version } : null;
    },

    async markSent(candidateId, applicationId, { version, origin }) {
      // One transaction, the Application locked (#771): « Relancée » and its Follow-up rows together or not at all, and a
      // second « Appliquer » from the same version waits, then finds it moved on.
      let marked: MarkSentResult;
      try {
        marked = await inTransaction(database, async (client): Promise<MarkSentResult> => {
          const before = await sentState(candidateId, applicationId, client, true);
          if (!before) return { ok: false, error: "not_found" };
          if (before.version !== version) return { ok: false, error: "conflict" };
          if (!WAITING_STATUSES.includes(before.status)) return { ok: false, error: "not_waiting" };
          if (before.count >= MAX_FOLLOW_UPS) return { ok: false, error: "limit" };
          // As the Applications module changes it from a Coach proposal (#715): now, with the card as its Origin.
          await client.query(`UPDATE application SET status = 'followed_up', status_changed_at = now(), status_origin = $2 WHERE id = $1`, [
            applicationId,
            JSON.stringify(origin),
          ]);
          const sentIds = await recordSent(client, applicationId, before);
          const after = (await sentState(candidateId, applicationId, client))!;
          return {
            ok: true,
            undo: { sentIds, status: before.status, origin: readOrigin(before.status_origin), statusVersion: after.status_version, version: after.version },
          };
        });
      } catch (error) {
        // Another record took the number meanwhile (the table's constraint): not what was proposed any more.
        if (isUniqueViolation(error) || isCheckViolation(error)) return { ok: false, error: "conflict" };
        throw error;
      }
      if (!marked.ok) return marked;
      // The Follow-up the AI Coach proposed on the Application is sent: its card no longer waits (it would not apply
      // any more either way: followUpCardApplies).
      const focus = { kind: "application", id: applicationId } as const;
      for (const card of await deps.actionCards.pending(candidateId, focus)) {
        if (card.kind === FOLLOW_UP_CARD) await deps.actionCards.withdraw(candidateId, card.id);
      }
      return marked;
    },

    async unmarkSent(candidateId, applicationId, undo) {
      const kept = unmarkSchema.safeParse(undo);
      if (!kept.success) return { ok: false, error: "not_found" };
      const { sentIds, status, origin, statusVersion, version } = kept.data;
      // The status and the Follow-up rows put back together, or nothing (#771).
      return inTransaction(database, async (client): Promise<UnmarkSentResult> => {
        const now = await sentState(candidateId, applicationId, client, true);
        if (!now) return { ok: false, error: "not_found" };
        if (now.version !== version || now.status_version !== statusVersion) return { ok: false, error: "conflict" };
        const restored = readOrigin(origin);
        await client.query(`UPDATE application SET status = $2, status_changed_at = now(), status_origin = $3 WHERE id = $1`, [
          applicationId,
          status,
          restored ? JSON.stringify(restored) : null,
        ]);
        await client.query(`DELETE FROM follow_up_sent WHERE application_id = $1 AND id = ANY($2::uuid[])`, [applicationId, sentIds]);
        return { ok: true };
      });
    },

    async setDelays(candidateId, input) {
      const parsed = delaysSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { afterApplied, afterFollowUp } = parsed.data;
      await database.query(
        `INSERT INTO follow_up_delay (candidate_id, after_applied, after_follow_up) VALUES ($1, $2, $3)
         ON CONFLICT (candidate_id) DO UPDATE SET after_applied = $2, after_follow_up = $3`,
        [candidateId, afterApplied, afterFollowUp],
      );
      return { ok: true, delays: { afterApplied, afterFollowUp } };
    },

    async notices(candidateId) {
      const cards = (await deps.actionCards.pendingOfKinds(candidateId, [...KINDS])).filter((card) => card.focus.kind === "application");
      const { rows } = await database.query<{ id: string; status: ApplicationStatus }>(
        `SELECT id::text, status FROM application WHERE candidate_id = $1 AND id::text = ANY($2::text[])`,
        [candidateId, cards.map((card) => card.focus.id)],
      );
      const statuses = new Map(rows.map((row) => [row.id, row.status]));
      return cards
        .filter((card) => {
          const status = statuses.get(card.focus.id);
          return status !== undefined && followUpCardApplies(card, status);
        })
        .map((card) => ({ applicationId: card.focus.id, jobTitle: payloadOf(card).jobTitle ?? "", kind: card.kind as FollowUpNotice["kind"] }));
    },
  };
}

/** Creates or upgrades the Follow-up tables. Run after the Candidate and Application tables. Safe to run repeatedly. */
export async function migrateFollowUps(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS follow_up_delay (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      after_applied integer NOT NULL CHECK (after_applied BETWEEN 1 AND ${MAX_FOLLOW_UP_DELAY}),
      after_follow_up integer NOT NULL CHECK (after_follow_up BETWEEN 1 AND ${MAX_FOLLOW_UP_DELAY})
    );
    CREATE TABLE IF NOT EXISTS follow_up_sent (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      sent_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS follow_up_sent_application_id_idx ON follow_up_sent (application_id);
    -- Each Follow-up sent has its number on the Application (#771): 1, then 2. Two records of the same number (two
    -- concurrent « Appliquer ») and a third Follow-up are refused by the table itself. Rows recorded before are numbered
    -- in the order they were sent; the check holds for new rows only (NOT VALID), so none recorded before is lost.
    ALTER TABLE follow_up_sent ADD COLUMN IF NOT EXISTS number smallint;
    UPDATE follow_up_sent s SET number = n.number
      FROM (SELECT id, row_number() OVER (PARTITION BY application_id ORDER BY sent_at, id) AS number FROM follow_up_sent) n
     WHERE s.id = n.id AND s.number IS NULL;
    ALTER TABLE follow_up_sent ALTER COLUMN number SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS follow_up_sent_number_idx ON follow_up_sent (application_id, number);
    ALTER TABLE follow_up_sent DROP CONSTRAINT IF EXISTS follow_up_sent_number_check;
    ALTER TABLE follow_up_sent ADD CONSTRAINT follow_up_sent_number_check CHECK (number BETWEEN 1 AND ${MAX_FOLLOW_UPS}) NOT VALID;
  `);
}
