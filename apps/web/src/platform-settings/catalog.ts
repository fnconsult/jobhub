/**
 * The Platform Settings (CONTEXT.md, ADR-0033): the non-secret settings the code gives a
 * default and env can override, and that super-admins will set in the Back Office's
 * Paramètres. Each has a group, a type (an allowed list, a bounded number, text or a
 * boolean) and its code default, taken from the code that reads it: the AI layer's
 * (`AI_ROUTING_SETTINGS`), the mailers', and this catalog's own for the Job Digest and
 * Job discovery, which their env readers read through `readNumberSetting`. One source of
 * truth for each default.
 *
 * Also the settings only env holds (`ENV_ONLY_SETTINGS`): the bootstrap settings, and the
 * other variables the code reads. Every variable the code reads is one or the other, or a
 * Provider Secret (a test scans the code for them).
 */
import { AI_ROUTING_SETTINGS } from "@jobhub/ai";
import { MAX_POSTING_AGE_DAYS } from "@jobhub/shared";
import { DEVELOPMENT_MAIL_FROM, isSender } from "../auth/mailers";
import { CONTACT_PROVIDERS, NO_PROVIDER } from "../enriched-contacts/providers/types";
import { SEARCH_TIMEOUT_MS } from "../job-searches";

/** The languages a Job Search's queries are worded in (JOB_DISCOVERY_QUERY_LANGUAGES): both, or one. */
export const QUERY_LANGUAGE_CHOICES = ["fr+en", "fr", "en"] as const;

/** The groups Paramètres shows the Platform Settings in, in order. */
export const PLATFORM_SETTING_GROUPS = ["ai_routing", "web_search", "email", "job_digest", "job_discovery", "enriched_contacts", "extension"] as const;
export type PlatformSettingGroup = (typeof PLATFORM_SETTING_GROUPS)[number];

/** What values a setting takes: the same rule the code applies to env's value. */
export type PlatformSettingType =
  /** One of `values`; `lowerCase`: compared and kept in lower case. */
  | { kind: "choice"; values: readonly string[]; lowerCase?: boolean }
  /** A number up to `max`, from `min` (or above it, with `aboveMin`); `whole`: no decimals. */
  | { kind: "number"; whole: boolean; min: number; max: number; aboveMin?: boolean }
  | { kind: "text" }
  /** An https URL (#303): a page people are sent to, never over plain http. */
  | { kind: "url" }
  /** An email sender our mailers send as: "Jobbbox <hello@jobbbox.ai>", or a bare address. */
  | { kind: "sender" }
  /** "true" or "false". */
  | { kind: "boolean" }
  /** A two-letter country code (ISO 3166-1 alpha-2), kept in upper case: a filter names a country by its code, never in words (ADR-0007). */
  | { kind: "country" };

export interface PlatformSetting {
  /** The environment variable of the same name. */
  name: string;
  group: PlatformSettingGroup;
  type: PlatformSettingType;
  /** The code's default, as env would hold it; empty: the code sets nothing (a provider's default model, another task's provider, off). */
  default: string;
  /** The value a super-admin confirms before it is set on Paramètres: a DPA marked signed (ADR-0015, #302). */
  confirm?: string;
}

/** The longest a Job discovery run may go: 5 minutes inside the 15-minute Job Search timeout, which stays the safety net. */
const MAX_DISCOVERY_SECONDS = SEARCH_TIMEOUT_MS / 1000 - 5 * 60;

const whole = (min: number, max: number): PlatformSettingType => ({ kind: "number", whole: true, min, max });
const decimal = (min: number, max: number): PlatformSettingType => ({ kind: "number", whole: false, min, max });
const aboveZero = (max: number, isWhole: boolean): PlatformSettingType => ({ kind: "number", whole: isWhole, min: 0, max, aboveMin: true });

export const PLATFORM_SETTINGS: readonly PlatformSetting[] = [
  ...AI_ROUTING_SETTINGS.map(
    (setting): PlatformSetting => ({
      name: setting.name,
      group: "ai_routing",
      type: setting.values ? { kind: "choice", values: setting.values } : setting.range ? whole(setting.range.min, setting.range.max) : { kind: "text" },
      default: setting.default,
    }),
  ),
  // The web search of Job discovery (#386, #402), on Paramètres' Recherche web tab: the country its pages are favoured from,
  // how old a posting may be, how many results a query asks for, how many job titles and in which languages its queries
  // are worded, how many Target Companies a run visits and how long before one is visited again (#406), and the monthly
  // web search spend that alerts super-admins (#403; 0: no alert, nothing is ever cut).
  { name: "JOB_DISCOVERY_COUNTRY", group: "web_search", type: { kind: "country" }, default: "FR" },
  { name: "JOB_DISCOVERY_MAX_POSTING_AGE_DAYS", group: "web_search", type: whole(1, 90), default: String(MAX_POSTING_AGE_DAYS) },
  { name: "JOB_DISCOVERY_RESULTS_PER_QUERY", group: "web_search", type: whole(5, 20), default: "20" },
  { name: "JOB_DISCOVERY_TITLES_PER_LANGUAGE", group: "web_search", type: whole(1, 5), default: "3" },
  { name: "JOB_DISCOVERY_QUERY_LANGUAGES", group: "web_search", type: { kind: "choice", values: QUERY_LANGUAGE_CHOICES, lowerCase: true }, default: "fr+en" },
  { name: "JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN", group: "web_search", type: whole(0, 10), default: "5" },
  { name: "JOB_DISCOVERY_COMPANY_REVISIT_DAYS", group: "web_search", type: whole(1, 30), default: "7" },
  { name: "WEB_SEARCH_MONTHLY_ALERT_EUR", group: "web_search", type: decimal(0, 1000), default: "2" },
  { name: "MAIL_FROM", group: "email", type: { kind: "sender" }, default: DEVELOPMENT_MAIL_FROM },
  // The Job Digest (worker): lowest Match Score, how many Job Offers it aims for, how far back a Profile's first one looks.
  { name: "JOB_DIGEST_MIN_MATCH_SCORE", group: "job_digest", type: whole(0, 100), default: "60" },
  { name: "JOB_DIGEST_TARGET_COUNT", group: "job_digest", type: whole(1, 100), default: "10" },
  { name: "JOB_DIGEST_FIRST_LOOK_BACK_DAYS", group: "job_digest", type: whole(0, 90), default: "7" },
  // A Job discovery run's budget (worker): Job Offers found, estimated € spent on AI calls, seconds run.
  { name: "JOB_DISCOVERY_BUDGET_JOB_OFFERS", group: "job_discovery", type: aboveZero(1000, true), default: "30" },
  { name: "JOB_DISCOVERY_BUDGET_EUR", group: "job_discovery", type: aboveZero(10, false), default: "0.08" },
  { name: "JOB_DISCOVERY_BUDGET_SECONDS", group: "job_discovery", type: aboveZero(MAX_DISCOVERY_SECONDS, true), default: "90" },
  // Enriched Contacts (ADR-0015): off without a provider, or until its DPA is signed.
  // "none" turns them off from Paramètres, over a provider env chose (#302).
  { name: "CONTACT_ENRICHMENT_PROVIDER", group: "enriched_contacts", type: { kind: "choice", values: [NO_PROVIDER, ...CONTACT_PROVIDERS], lowerCase: true }, default: "" },
  // The code cannot tell whether the agreement exists: marking it signed is a deliberate, confirmed step.
  { name: "CONTACT_ENRICHMENT_DPA_SIGNED", group: "enriched_contacts", type: { kind: "boolean" }, default: "false", confirm: "true" },
  // The browser extension's Chrome Web Store page; empty: "coming soon".
  { name: "EXTENSION_STORE_URL", group: "extension", type: { kind: "url" }, default: "" },
];

const BY_NAME = new Map(PLATFORM_SETTINGS.map((setting) => [setting.name, setting]));

/** The Platform Setting named `name`, if it is one. */
export const platformSetting = (name: string): PlatformSetting | undefined => BY_NAME.get(name);

/**
 * The groups super-admins edit on Paramètres so far: the worker's Job Digest and Job discovery (#299),
 * AI routing (#301), the email sender (#300), Enriched Contacts (#302) and the extension's store page (#303).
 * The others are shown read-only until their slice of ADR-0033 ships.
 */
const EDITABLE_GROUPS: readonly PlatformSettingGroup[] = ["ai_routing", "web_search", "email", "job_digest", "job_discovery", "enriched_contacts", "extension"];

/** Whether super-admins set `setting` on Paramètres (and « Rétablir » it). */
export const isEditable = (setting: PlatformSetting): boolean => EDITABLE_GROUPS.includes(setting.group);

/** Whether setting `setting` to `raw` waits for the super-admin's confirmation: a DPA marked signed (#302). */
export function asksConfirmation(setting: PlatformSetting, raw: string): boolean {
  if (setting.confirm === undefined) return false;
  const parsed = parseSetting(setting, raw);
  return parsed.ok && String(parsed.value) === setting.confirm;
}

export type ParsedSetting = { ok: true; value: string | number | boolean } | { ok: false; error: string };

/** What `type` asks of a value, said as in an error: "a whole number from 0 to 100". */
function rule(type: PlatformSettingType): string {
  switch (type.kind) {
    case "choice":
      return `one of ${type.values.join(", ")}`;
    case "number":
      return `a ${type.whole ? "whole " : ""}number ${type.aboveMin ? `above ${type.min}, up to ${type.max}` : `from ${type.min} to ${type.max}`}`;
    case "text":
      return "some text";
    case "url":
      return "an https URL";
    case "sender":
      return "an email sender, such as Jobbbox <hello@jobbbox.ai>";
    case "boolean":
      return "true or false";
    case "country":
      return "a two-letter country code, such as FR";
  }
}

/** Whether `value` is an absolute https URL naming a host. */
function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

/** `raw` (trimmed) as `setting` takes it, or why not. An empty value is not one: env leaving it empty means it is not set. */
export function parseSetting(setting: PlatformSetting, raw: string): ParsedSetting {
  const value = raw.trim();
  const refused: ParsedSetting = { ok: false, error: `${setting.name} must be ${rule(setting.type)} (got "${value}")` };
  if (!value) return refused;
  const { type } = setting;
  switch (type.kind) {
    case "choice": {
      const chosen = type.lowerCase ? value.toLowerCase() : value;
      return type.values.includes(chosen) ? { ok: true, value: chosen } : refused;
    }
    case "number": {
      const number = Number(value);
      const inRange = Number.isFinite(number) && (type.aboveMin ? number > type.min : number >= type.min) && number <= type.max;
      return inRange && (!type.whole || Number.isInteger(number)) ? { ok: true, value: number } : refused;
    }
    case "text":
      return { ok: true, value };
    case "url":
      return isHttpsUrl(value) ? { ok: true, value } : refused;
    case "sender":
      return isSender(value) ? { ok: true, value } : refused;
    case "boolean":
      return value === "true" || value === "false" ? { ok: true, value: value === "true" } : refused;
    case "country":
      return /^[a-z]{2}$/i.test(value) ? { ok: true, value: value.toUpperCase() } : refused;
  }
}

/**
 * The Platform Setting `name` from `env`, else its code default, as its type parses it (a number, a choice, a country
 * code…). A value the setting does not take throws, naming it.
 */
export function readSetting(env: Record<string, string | undefined>, name: string): string | number | boolean {
  const setting = platformSetting(name);
  if (!setting) throw new Error(`${name} is not a Platform Setting`);
  const parsed = parseSetting(setting, env[name]?.trim() || setting.default);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * The number setting `name` from `env`, else its code default: how the Job Digest's and Job
 * discovery's env readers read theirs. A value the setting does not take throws, naming it.
 */
export function readNumberSetting(env: Record<string, string | undefined>, name: string): number {
  const setting = platformSetting(name);
  if (setting?.type.kind !== "number") throw new Error(`${name} is not a number Platform Setting`);
  const parsed = parseSetting(setting, env[name]?.trim() || setting.default);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value as number;
}

/** Why a variable stays in env alone, never set in the Back Office. */
export type EnvOnlyKind =
  /** Needed before the database can be read, or to open what it holds: Paramètres shows it, read-only. */
  | "bootstrap"
  /** Shown on Paramètres, read-only, but not editable there (yet): MAIL_TRANSPORT, Stripe Prices. */
  | "read_only"
  /** A key outside the Provider Secrets (a provider not offered in Clés, a Sign-in Provider's fallback): never shown. */
  | "secret"
  /** Set by the runtime or the deployment, not by an Administrator: never shown. */
  | "deployment"
  /** Another API origin for the e2e suite's fakes: never shown. */
  | "test";

/** How Paramètres shows a variable only env holds: its value, a URL without its password, only whether it is set, or a keyring's versions. */
export type EnvOnlyShown = false | "value" | "without_password" | "set_or_missing" | "key_versions";

/**
 * Every variable the code reads that is neither a Platform Setting nor a Provider Secret, in the
 * order Paramètres shows those it shows.
 */
export const ENV_ONLY_SETTINGS = {
  DATABASE_URL: { kind: "bootstrap", shown: "without_password" },
  AUTH_SECRET: { kind: "bootstrap", shown: "set_or_missing" },
  SECRETS_MASTER_KEYS: { kind: "bootstrap", shown: "key_versions" },
  APP_URL: { kind: "bootstrap", shown: "value" },
  ADMIN_EMAILS: { kind: "bootstrap", shown: "value" },
  JOBHUB_TARGET: { kind: "bootstrap", shown: "value" },
  AI_FAKE: { kind: "bootstrap", shown: "value" },
  MAIL_TRANSPORT: { kind: "read_only", shown: "value" },
  // Fallbacks on their way out (#206), and the Coaching Session Prices.
  STRIPE_PRICE_STANDARD: { kind: "read_only", shown: "value" },
  STRIPE_PRICE_PREMIUM: { kind: "read_only", shown: "value" },
  STRIPE_PRICE_COACHING_SESSION: { kind: "read_only", shown: "value" },
  STRIPE_PRICE_COACHING_SESSION_PREMIUM: { kind: "read_only", shown: "value" },
  OPENAI_API_KEY: { kind: "secret", shown: false },
  BRAVE_SEARCH_API_KEY: { kind: "secret", shown: false },
  TAVILY_API_KEY: { kind: "secret", shown: false },
  // The Google client the Sign-in Providers are seeded with (Connexion), and its secret's fallback.
  GOOGLE_CLIENT_ID: { kind: "secret", shown: false },
  GOOGLE_CLIENT_SECRET: { kind: "secret", shown: false },
  NODE_ENV: { kind: "deployment", shown: false },
  NEXT_RUNTIME: { kind: "deployment", shown: false },
  // The deployed commit (deploy/compose.yml): the Jobbbox version a Signalement keeps (#374).
  JOBHUB_REVISION: { kind: "deployment", shown: false },
  DATABASE_POOL_MAX: { kind: "deployment", shown: false },
  EXTENSION_ORIGINS: { kind: "deployment", shown: false },
  WXT_WEB_ORIGIN: { kind: "deployment", shown: false },
  // Fantastic.jobs (ADR-0031): the € per job of the plan an environment pays for, and the jobs one search may spend.
  // ADR-0033 does not list them as Platform Settings: they stay in env until an amendment makes them one.
  FANTASTIC_JOBS_EUR_PER_JOB: { kind: "deployment", shown: false },
  FANTASTIC_JOBS_MAX_PER_SEARCH: { kind: "deployment", shown: false },
  BREVO_API_URL: { kind: "test", shown: false },
  STRIPE_API_URL: { kind: "test", shown: false },
  CONTACT_ENRICHMENT_API_URL: { kind: "test", shown: false },
  FANTASTIC_JOBS_API_URL: { kind: "test", shown: false },
} as const satisfies Record<string, { kind: EnvOnlyKind; shown: EnvOnlyShown }>;

export type EnvOnlySettingName = keyof typeof ENV_ONLY_SETTINGS;

/** What took the place of a variable Jobbbox no longer reads. */
export type RetiredBy = "coaching_playbooks";

/**
 * The env variables Jobbbox once read and no longer does (#396): Paramètres' Environnement tab lists those an
 * environment still sets, so an old `.env` can be cleaned. A guard test keeps the code from reading one again.
 */
export const RETIRED_SETTINGS = {
  // The coaching knowledge's environment (#174): Coaching Playbooks are now edited and validated in the Back Office (ADR-0021).
  COACH_KNOWLEDGE_ENVIRONMENT: "coaching_playbooks",
} as const satisfies Record<string, RetiredBy>;

export type RetiredSettingName = keyof typeof RETIRED_SETTINGS;
