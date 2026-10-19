/**
 * What the Back Office tunes of the Guardrails (#228, ADR-0022), and the Guardrail Triggers, in Postgres.
 *
 * One deep module. `createGuardrailStore(database, { serving })` answers:
 *  - what the checks use     `config` (each Guardrail's setting and the Guardrail messages served), `triggers` (where they are recorded)
 *  - what there is           `list`: each Guardrail with its setting and, per language, its latest and served message
 *  - write                   `setSetting`, `saveMessage`, `validateMessage`
 *  - what happened           `triggersPerDay`: Guardrail Triggers counted per day (Paris time) and per Guardrail
 * and `purgeExpiredGuardrailTriggers(database, now)` (the worker, nightly) and `migrateGuardrails(database)`.
 *
 * Rules kept here, whoever calls:
 *  - A Guardrail blocks until set to flag only; distress, personal data leak and secret disclosure can never be.
 *  - Each saved Guardrail message is a new version, by its author; a version is Human-validated once, by a named
 *    Administrator other than its author, only while it is the latest; each language apart.
 *  - `serving: "validated"` (production) serves the latest Human-validated message of each language,
 *    `"latest"` (every other environment) the latest; until there is one, the default text from code
 *    applies. A distress message must give the 3114 helpline.
 *  - A Guardrail Trigger holds which Guardrail, its setting, what it did, for which agent, and when: no
 *    Candidate, no Coach Conversation, no text. Kept TRIGGER_RETENTION_MONTHS, outside the Data export.
 *
 * Every write takes an optional `within`: it then runs in the caller's transaction, as the Back Office
 * does to record it in the Back Office Audit (see admin/guardrails-back-office.ts). Inputs are untrusted.
 */
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import {
  ALWAYS_ON_GUARDRAILS,
  DEFAULT_GUARDRAIL_MESSAGES,
  GUARDRAIL_IDS,
  GUARDRAIL_LANGUAGES,
  GUARDRAIL_SETTINGS,
  isGuardrailId,
  type GuardrailAction,
  type GuardrailConfig,
  type GuardrailId,
  type GuardrailLanguage,
  type GuardrailMessages,
  type GuardrailSetting,
  type GuardrailTriggerLog,
} from "./index";

/** How long a Guardrail Trigger is kept, like AI Usage. */
export const TRIGGER_RETENTION_MONTHS = 24;

/** Longest Guardrail message, in characters. */
export const MAX_GUARDRAIL_MESSAGE_LENGTH = 2_000;

/** The helpline every distress message gives. */
export const DISTRESS_HELPLINE = "3114";

/** Which messages this environment serves: production only Human-validated ones. */
export type GuardrailMessageServing = "validated" | "latest";

export interface GuardrailMessageVersion {
  guardrail: GuardrailId;
  language: GuardrailLanguage;
  /** From 1, per Guardrail and language. */
  version: number;
  text: string;
  /** The email of the Administrator who wrote it. */
  author: string;
  createdAt: Date;
  validation: { name: string; email: string; at: Date } | null;
}

/** One Guardrail as the Back Office shows it. `served`: null while the default text applies. */
export interface GuardrailOverview {
  id: GuardrailId;
  alwaysOn: boolean;
  setting: GuardrailSetting;
  messages: Record<GuardrailLanguage, { latest: GuardrailMessageVersion | null; served: GuardrailMessageVersion | null; default: string }>;
}

/** Guardrail Triggers of one day (Paris time) and one Guardrail. */
export interface GuardrailTriggerDay {
  /** "2026-10-19". */
  day: string;
  guardrail: GuardrailId;
  blocked: number;
  flagged: number;
  unavailable: number;
}

export type SetSettingResult =
  | { ok: true; before: GuardrailSetting; after: GuardrailSetting; changed: boolean }
  | { ok: false; error: "not_found" | "invalid" | "always_on" };

export type SaveMessageResult =
  | { ok: true; before: GuardrailMessageVersion | null; version: GuardrailMessageVersion }
  | { ok: false; error: "not_found" | "invalid" | "unchanged" | "helpline_missing" };

export type ValidateMessageResult =
  | { ok: true; version: GuardrailMessageVersion }
  | { ok: false; error: "not_found" | "not_latest" | "already_validated" | "own_message" };

export interface GuardrailStore {
  config: GuardrailConfig;
  triggers: GuardrailTriggerLog;
  list(): Promise<GuardrailOverview[]>;
  /** `id` and `setting` are untrusted. */
  setSetting(id: string, setting: unknown, within?: Queryable): Promise<SetSettingResult>;
  /** `id`, `language` and `text` are untrusted. */
  saveMessage(author: { email: string }, id: string, language: string, text: unknown, within?: Queryable): Promise<SaveMessageResult>;
  validateMessage(validator: { email: string; name: string }, id: string, language: string, version: number, within?: Queryable): Promise<ValidateMessageResult>;
  /** The Guardrail Triggers from `since` on, newest day first, then by Guardrail. */
  triggersPerDay(since: Date): Promise<GuardrailTriggerDay[]>;
}

export async function migrateGuardrails(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS guardrail_setting (
      guardrail text PRIMARY KEY,
      setting text NOT NULL CHECK (setting IN ('block', 'flag')),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS guardrail_message (
      guardrail text NOT NULL,
      language text NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      text text NOT NULL,
      author text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      validated_by_name text,
      validated_by_email text,
      validated_at timestamptz,
      PRIMARY KEY (guardrail, language, version)
    );
    -- No Candidate, no Coach Conversation, no text (ADR-0022): aggregates of no one, kept 24 months.
    CREATE TABLE IF NOT EXISTS guardrail_trigger (
      id bigserial PRIMARY KEY,
      guardrail text NOT NULL,
      setting text NOT NULL,
      action text NOT NULL CHECK (action IN ('blocked', 'flagged', 'unavailable')),
      agent text NOT NULL,
      at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guardrail_trigger_at_idx ON guardrail_trigger (at);
  `);
}

/** Deletes the Guardrail Triggers TRIGGER_RETENTION_MONTHS old or more at `now`; returns how many. Safe to run again. */
export async function purgeExpiredGuardrailTriggers(database: Pick<Pool, "query">, now: Date): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM guardrail_trigger WHERE at <= $1::timestamptz - make_interval(months => $2)`, [now, TRIGGER_RETENTION_MONTHS]);
  return rowCount ?? 0;
}

interface MessageRow {
  guardrail: GuardrailId;
  language: GuardrailLanguage;
  version: number;
  text: string;
  author: string;
  created_at: Date;
  validated_by_name: string | null;
  validated_by_email: string | null;
  validated_at: Date | null;
}

const MESSAGE_COLUMNS = "guardrail, language, version, text, author, created_at, validated_by_name, validated_by_email, validated_at";

const messageFrom = (row: MessageRow): GuardrailMessageVersion => ({
  guardrail: row.guardrail,
  language: row.language,
  version: row.version,
  text: row.text,
  author: row.author,
  createdAt: row.created_at,
  validation: row.validated_at ? { name: row.validated_by_name ?? "", email: row.validated_by_email ?? "", at: row.validated_at } : null,
});

const isLanguage = (value: unknown): value is GuardrailLanguage => GUARDRAIL_LANGUAGES.includes(value as GuardrailLanguage);
const isSetting = (value: unknown): value is GuardrailSetting => GUARDRAIL_SETTINGS.includes(value as GuardrailSetting);
const normalEmail = (email: string) => email.trim().toLowerCase();
const key = (id: string, language: string) => `${id} ${language}`;

export function createGuardrailStore(database: Pool, deps: { serving: GuardrailMessageServing }): GuardrailStore {
  async function settings(within: Queryable): Promise<Record<GuardrailId, GuardrailSetting>> {
    const { rows } = await within.query<{ guardrail: string; setting: GuardrailSetting }>("SELECT guardrail, setting FROM guardrail_setting");
    const stored = new Map(rows.map((row) => [row.guardrail, row.setting]));
    return Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, ALWAYS_ON_GUARDRAILS.includes(id) ? "block" : (stored.get(id) ?? "block")])) as Record<GuardrailId, GuardrailSetting>;
  }

  /** The latest, or the latest Human-validated, message of each Guardrail and language. */
  async function latestMessages(within: Queryable, validatedOnly: boolean): Promise<Map<string, GuardrailMessageVersion>> {
    const { rows } = await within.query<MessageRow>(
      `SELECT DISTINCT ON (guardrail, language) ${MESSAGE_COLUMNS} FROM guardrail_message
        WHERE NOT $1 OR validated_at IS NOT NULL ORDER BY guardrail, language, version DESC`,
      [validatedOnly],
    );
    return new Map(rows.map((row) => [key(row.guardrail, row.language), messageFrom(row)]));
  }

  const servedMessages = (within: Queryable) => latestMessages(within, deps.serving === "validated");

  return {
    config: {
      async current() {
        const [current, served] = await Promise.all([settings(database), servedMessages(database)]);
        const messages = Object.fromEntries(
          GUARDRAIL_IDS.map((id) => [id, Object.fromEntries(GUARDRAIL_LANGUAGES.map((language) => [language, served.get(key(id, language))?.text ?? DEFAULT_GUARDRAIL_MESSAGES[id][language]]))]),
        ) as GuardrailMessages;
        return { settings: current, messages };
      },
    },

    triggers: {
      async record(trigger) {
        await database.query("INSERT INTO guardrail_trigger (guardrail, setting, action, agent, at) VALUES ($1, $2, $3, $4, $5)", [
          trigger.guardrail,
          trigger.setting,
          trigger.action,
          trigger.agent,
          trigger.at,
        ]);
      },
    },

    async list() {
      const [current, latest, served] = await Promise.all([settings(database), latestMessages(database, false), servedMessages(database)]);
      return GUARDRAIL_IDS.map((id) => ({
        id,
        alwaysOn: ALWAYS_ON_GUARDRAILS.includes(id),
        setting: current[id],
        messages: Object.fromEntries(
          GUARDRAIL_LANGUAGES.map((language) => [
            language,
            { latest: latest.get(key(id, language)) ?? null, served: served.get(key(id, language)) ?? null, default: DEFAULT_GUARDRAIL_MESSAGES[id][language] },
          ]),
        ) as GuardrailOverview["messages"],
      }));
    },

    async setSetting(id, setting, within = database) {
      if (!isGuardrailId(id)) return { ok: false, error: "not_found" };
      if (!isSetting(setting)) return { ok: false, error: "invalid" };
      if (ALWAYS_ON_GUARDRAILS.includes(id)) return { ok: false, error: "always_on" };
      const before = (await settings(within))[id];
      if (before === setting) return { ok: true, before, after: setting, changed: false };
      await within.query(
        `INSERT INTO guardrail_setting (guardrail, setting) VALUES ($1, $2)
         ON CONFLICT (guardrail) DO UPDATE SET setting = EXCLUDED.setting, updated_at = now()`,
        [id, setting],
      );
      return { ok: true, before, after: setting, changed: true };
    },

    async saveMessage(author, id, language, text, within = database) {
      if (!isGuardrailId(id) || !isLanguage(language)) return { ok: false, error: "not_found" };
      const content = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
      if (!content || content.length > MAX_GUARDRAIL_MESSAGE_LENGTH) return { ok: false, error: "invalid" };
      if (id === "distress" && !content.includes(DISTRESS_HELPLINE)) return { ok: false, error: "helpline_missing" };
      const before = (await latestMessages(within, false)).get(key(id, language)) ?? null;
      if (before?.text === content) return { ok: false, error: "unchanged" };
      // The primary key refuses a second version with the same number: two saves at once cannot both win.
      const { rows } = await within.query<MessageRow>(
        `INSERT INTO guardrail_message (guardrail, language, version, text, author) VALUES ($1, $2, $3, $4, $5) RETURNING ${MESSAGE_COLUMNS}`,
        [id, language, (before?.version ?? 0) + 1, content, normalEmail(author.email)],
      );
      return { ok: true, before, version: messageFrom(rows[0]!) };
    },

    async validateMessage(validator, id, language, version, within = database) {
      if (!isGuardrailId(id) || !isLanguage(language)) return { ok: false, error: "not_found" };
      const latest = (await latestMessages(within, false)).get(key(id, language));
      if (!latest || !Number.isInteger(version) || version < 1 || version > latest.version) return { ok: false, error: "not_found" };
      if (version !== latest.version) return { ok: false, error: "not_latest" };
      if (latest.validation) return { ok: false, error: "already_validated" };
      const email = normalEmail(validator.email);
      if (latest.author === email) return { ok: false, error: "own_message" };
      const { rows } = await within.query<MessageRow>(
        `UPDATE guardrail_message SET validated_by_name = $4, validated_by_email = $5, validated_at = clock_timestamp()
          WHERE guardrail = $1 AND language = $2 AND version = $3 AND validated_at IS NULL RETURNING ${MESSAGE_COLUMNS}`,
        [id, language, version, validator.name.trim() || email, email],
      );
      return rows[0] ? { ok: true, version: messageFrom(rows[0]) } : { ok: false, error: "already_validated" };
    },

    async triggersPerDay(since) {
      const { rows } = await database.query<{ day: string; guardrail: GuardrailId; action: GuardrailAction; n: number }>(
        `SELECT to_char(at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, guardrail, action, count(*)::int AS n
           FROM guardrail_trigger WHERE at >= $1 GROUP BY 1, 2, 3`,
        [since],
      );
      const days = new Map<string, GuardrailTriggerDay>();
      for (const row of rows) {
        const day = days.get(key(row.day, row.guardrail)) ?? { day: row.day, guardrail: row.guardrail, blocked: 0, flagged: 0, unavailable: 0 };
        day[row.action] += row.n;
        days.set(key(row.day, row.guardrail), day);
      }
      return [...days.values()].sort((a, b) => b.day.localeCompare(a.day) || GUARDRAIL_IDS.indexOf(a.guardrail) - GUARDRAIL_IDS.indexOf(b.guardrail));
    },
  };
}
