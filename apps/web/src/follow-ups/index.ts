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
 * Every read and change is scoped to the Candidate; inputs are untrusted and
 * problems come back as results (but for `onAccept`, which throws so the card stays pending).
 */
import type { AiLayer } from "@jobhub/ai";
import { jobOfferLanguage, type ApplicationStatus, type DocumentLanguage } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import * as z from "zod";
import type { AcceptHandler, ActionCard, ActionCards } from "../action-cards";
import type { Applications } from "../applications";
import type { Mailer } from "../auth";
import { routes } from "../routes";
import { fieldErrors, type FieldError } from "../validation";
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

export interface FollowUps {
  proposeDue(now: Date): Promise<void>;
  onAccept: Record<string, AcceptHandler>;
  delays(candidateId: string): Promise<FollowUpDelays>;
  /** `input`: { afterApplied, afterFollowUp }, whole working days from 1 to MAX_FOLLOW_UP_DELAY. */
  setDelays(candidateId: string, input: unknown): Promise<SetDelaysResult>;
  notices(candidateId: string): Promise<FollowUpNotice[]>;
}

export interface FollowUpsDeps {
  /** Where the cards are proposed (without handlers: proposing only). */
  actionCards: Pick<ActionCards, "propose" | "pending" | "dismissed" | "pendingOfKinds">;
  applications: Pick<Applications, "change">;
  /** Delivers the notice email to the Candidate. */
  mailer: Mailer;
  /** Public origin of the web app, for the link in the notice email. */
  appUrl: string;
  /** Optional: without it (or when it fails), the Follow-up is drafted from a plain template. */
  ai?: AiLayer;
  /** The clock a Follow-up is marked as sent by. Defaults to the real time. */
  now?: () => Date;
}

const delay = z.coerce.number().int().min(1).max(MAX_FOLLOW_UP_DELAY);
const delaysSchema = z.object({ afterApplied: delay, afterFollowUp: delay });

const KINDS = [FOLLOW_UP_CARD, ABANDON_CARD] as const;

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
    // A "Relancée" the Candidate set by hand (after the last Follow-up marked as sent, if any) counts as one sent.
    const byHand = row.status === "followed_up" && (!row.last_sent_at || row.status_changed_at > row.last_sent_at) ? 1 : 0;
    const sent = row.sent + byHand;
    const kind = sent >= MAX_FOLLOW_UPS ? ABANDON_CARD : FOLLOW_UP_CARD;
    if (dismissed.some((card) => card.kind === kind && payloadOf(card).since === since.toISOString())) return false;

    const { t } = createI18n(row.interface_language);
    const payload: FollowUpPayload = { since: since.toISOString(), jobTitle: row.title };
    if (kind === FOLLOW_UP_CARD) {
      const language = row.document_language ?? jobOfferLanguage({ title: row.title, content: row.content });
      const draft = await followUpDraft({ ai: deps.ai, candidateId: row.candidate_id, language, jobOffer: row, followUpNumber: sent + 1 });
      Object.assign(payload, draft);
      await deps.actionCards.propose(row.candidate_id, { kind, focus, payload, title: t("followUps.cardTitle", { title: row.title }), body: draft.text });
    } else {
      await deps.actionCards.propose(row.candidate_id, {
        kind,
        focus,
        payload,
        title: t("followUps.abandonTitle", { title: row.title }),
        body: t("followUps.abandonBody", { count: sent }),
      });
    }
    const url = new URL(routes.application(row.id), deps.appUrl).toString();
    const email = kind === FOLLOW_UP_CARD ? "followUps.email" : "followUps.abandonEmail";
    try {
      await deps.mailer.send({ to: row.email, subject: t(`${email}.subject`, { title: row.title }), text: t(`${email}.body`, { title: row.title, url }) });
    } catch (error) {
      // The card is on the Application all the same: the email is only a notice.
      console.warn("[follow-ups] the notice email could not be sent:", error instanceof Error ? error.message : error);
    }
    return true;
  }

  async function moveTo(card: ActionCard, candidateId: string, status: ApplicationStatus) {
    if (card.focus.kind !== "application") throw new Error("not a card on an Application");
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
          WHERE a.status IN ('applied', 'followed_up')
          ORDER BY a.status_changed_at, a.id`,
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
        const { rows } = await database.query<{ status: ApplicationStatus; status_changed_at: Date; last_sent_at: Date | null }>(
          `SELECT a.status, a.status_changed_at, (SELECT max(sent_at) FROM follow_up_sent s WHERE s.application_id = a.id) AS last_sent_at
             FROM application a WHERE a.id = $1 AND a.candidate_id = $2`,
          [card.focus.id, candidateId],
        );
        const before = rows[0];
        await moveTo(card, candidateId, "followed_up");
        // A "Relancée" set by hand before this Follow-up still counts as one sent.
        if (before?.status === "followed_up" && (!before.last_sent_at || before.status_changed_at > before.last_sent_at)) {
          await database.query(`INSERT INTO follow_up_sent (application_id, sent_at) VALUES ($1, $2)`, [card.focus.id, before.status_changed_at]);
        }
        // Never before the status change it caused, so it is not taken for a "Relancée" set by hand.
        await database.query(
          `INSERT INTO follow_up_sent (application_id, sent_at) SELECT id, greatest($2::timestamptz, status_changed_at) FROM application WHERE id = $1`,
          [card.focus.id, now()],
        );
      },
      [ABANDON_CARD]: (card, candidateId) => moveTo(card, candidateId, "abandoned"),
    },

    delays,

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
      const cards = await deps.actionCards.pendingOfKinds(candidateId, [...KINDS]);
      return cards
        .filter((card) => card.focus.kind === "application")
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
  `);
}
