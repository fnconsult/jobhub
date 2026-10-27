/**
 * The monthly web search alert (#403, ADR-0042): once the month's web search spend (Paris time) reaches
 * WEB_SEARCH_MONTHLY_ALERT_EUR, every super-admin gets one email, once that month, and Consommation IA shows a
 * banner. Nothing is cut: Job discovery and Company Dossiers search on.
 *
 *   const alert = createWebSearchAlert({ store: postgresWebSearchAlertStore(database), thresholdEur, superAdmins, mailer, appUrl });
 *   await alert.check(); // { month: "2026-10", spendEur, thresholdEur, outcome: "off" | "below" | "sent" | "already_sent" }
 *   await alert.state(); // what the banner says: crossed or not, and when super-admins were emailed
 *
 * The spend is what AI Usage recorded for the web_search task's calls (tokens and billed units, at the prices in use
 * when each was made): list prices, not net of a provider's free monthly allowance. A threshold of 0 alerts nobody.
 * The month's alert is claimed before its emails are sent, and given back when sending fails, so the next check tries
 * again: never two alerts the same month.
 */
import { SEARCH_TASK } from "@jobhub/ai";
import { createI18n } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import { aiUsageMonths, aiUsagePeriod } from "../ai-usage/index";
import type { Mailer } from "../auth/index";
import { readNumberSetting } from "../platform-settings/catalog";
import { routes } from "../routes";

/** A month's alert, once sent. */
export interface SentWebSearchAlert {
  /** "2026-10", Paris time. */
  month: string;
  spendEur: number;
  thresholdEur: number;
  at: Date;
}

/** Where the months' web search spend is read and their alerts kept. */
export interface WebSearchAlertStore {
  /** The month's web search spend so far, in €, as AI Usage recorded it. */
  spendEur(month: string): Promise<number>;
  /** Takes the month's alert: true the first time, false once it was taken. */
  claim(alert: SentWebSearchAlert): Promise<boolean>;
  /** Gives the month's alert back, its emails not sent. */
  release(month: string): Promise<void>;
  /** The month's alert, when it was sent. */
  sent(month: string): Promise<SentWebSearchAlert | null>;
}

export interface WebSearchAlertCheck {
  month: string;
  spendEur: number;
  thresholdEur: number;
  /** off: no threshold (0); below: not reached; sent: just emailed; already_sent: emailed earlier this month. */
  outcome: "off" | "below" | "sent" | "already_sent";
}

/** What Consommation IA's banner says of this month. */
export interface WebSearchAlertState {
  month: string;
  spendEur: number;
  thresholdEur: number;
  /** The threshold is set and the spend reached it. */
  crossed: boolean;
  /** When super-admins were emailed this month; null while they were not. */
  emailedAt: Date | null;
}

export interface WebSearchAlertOptions {
  store: WebSearchAlertStore;
  /** WEB_SEARCH_MONTHLY_ALERT_EUR in use, asked at each check (a change on Paramètres applies to the next). */
  thresholdEur: () => number;
  /** Who is emailed: every super-admin. */
  superAdmins: () => Promise<string[]>;
  mailer: Pick<Mailer, "send">;
  /** The Back Office's address, for the link to Consommation IA. */
  appUrl: string;
  now?: () => Date;
}

export interface WebSearchAlert {
  /** Emails every super-admin once the month's spend reaches its threshold, once a month. Rejects when the emails could not be sent. */
  check(): Promise<WebSearchAlertCheck>;
  state(): Promise<WebSearchAlertState>;
}

/** WEB_SEARCH_MONTHLY_ALERT_EUR as `env` (or the Back Office over it) holds it, else its default: 0 alerts nobody. */
export const webSearchAlertThresholdFromEnv = (env: Record<string, string | undefined>): number => readNumberSetting(env, "WEB_SEARCH_MONTHLY_ALERT_EUR");

/** The current month, Paris time: "2026-10". */
const monthAt = (now: Date) => aiUsageMonths(now)[0]!;

export function createWebSearchAlert(options: WebSearchAlertOptions): WebSearchAlert {
  const now = options.now ?? (() => new Date());
  const read = async () => {
    const at = now();
    const month = monthAt(at);
    const thresholdEur = options.thresholdEur();
    const spendEur = await options.store.spendEur(month);
    return { at, month, thresholdEur, spendEur, crossed: thresholdEur > 0 && spendEur >= thresholdEur };
  };
  return {
    async check() {
      const { at, month, thresholdEur, spendEur, crossed } = await read();
      const facts = { month, spendEur, thresholdEur };
      if (thresholdEur <= 0) return { ...facts, outcome: "off" };
      if (!crossed) return { ...facts, outcome: "below" };
      if (!(await options.store.claim({ ...facts, at }))) return { ...facts, outcome: "already_sent" };
      try {
        const email = webSearchAlertEmail(facts, options.appUrl);
        for (const to of await options.superAdmins()) await options.mailer.send({ to, ...email });
      } catch (error) {
        await options.store.release(month);
        throw error;
      }
      return { ...facts, outcome: "sent" };
    },
    async state() {
      const { month, thresholdEur, spendEur, crossed } = await read();
      const sent = await options.store.sent(month);
      return { month, spendEur, thresholdEur, crossed, emailedAt: sent?.at ?? null };
    },
  };
}

/** The email super-admins get, in French (the Jobbbox team's language): the month's spend, its threshold, nothing cut. */
export function webSearchAlertEmail(alert: { month: string; spendEur: number; thresholdEur: number }, appUrl: string): { subject: string; text: string } {
  const { t } = createI18n("fr");
  const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
  const url = new URL(routes.adminAiUsage(alert.month), appUrl).toString();
  return {
    subject: t("webSearchAlert.subject", { month: alert.month }),
    text: t("webSearchAlert.body", { month: alert.month, spend: eur.format(alert.spendEur), threshold: eur.format(alert.thresholdEur), url }),
  };
}

/** The months' spend from AI Usage, and their alerts in `web_search_alert`. */
export function postgresWebSearchAlertStore(database: Pick<Pool, "query">, now: () => Date = () => new Date()): WebSearchAlertStore {
  return {
    async spendEur(month) {
      const { from, to } = aiUsagePeriod(month, now());
      const { rows } = await database.query<{ spend: number | null }>(
        `SELECT sum(u.cost_eur + coalesce((SELECT sum(t.cost_eur) FROM ai_tool_usage t WHERE t.usage_id = u.id), 0)) AS spend
           FROM ai_usage u
          WHERE u.task = $3
            AND u.at >= $1::timestamp AT TIME ZONE 'Europe/Paris' AND u.at < $2::timestamp AT TIME ZONE 'Europe/Paris'`,
        [from, to, SEARCH_TASK],
      );
      return Number(rows[0]?.spend ?? 0);
    },
    async claim(alert) {
      const { rowCount } = await database.query(
        `INSERT INTO web_search_alert (month, spend_eur, threshold_eur, sent_at) VALUES ($1, $2, $3, $4) ON CONFLICT (month) DO NOTHING`,
        [alert.month, alert.spendEur, alert.thresholdEur, alert.at],
      );
      return rowCount === 1;
    },
    async release(month) {
      await database.query(`DELETE FROM web_search_alert WHERE month = $1`, [month]);
    },
    async sent(month) {
      const { rows } = await database.query<{ month: string; spend_eur: number; threshold_eur: number; sent_at: Date }>(
        `SELECT month, spend_eur, threshold_eur, sent_at FROM web_search_alert WHERE month = $1`,
        [month],
      );
      const row = rows[0];
      return row ? { month: row.month, spendEur: row.spend_eur, thresholdEur: row.threshold_eur, at: row.sent_at } : null;
    },
  };
}

/** Creates the table of the months' alerts: no Candidate, nothing personal. Safe to run repeatedly. */
export async function migrateWebSearchAlerts(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS web_search_alert (
      -- "2026-10", Paris time: one alert a month at most.
      month text PRIMARY KEY,
      spend_eur double precision NOT NULL,
      threshold_eur double precision NOT NULL,
      sent_at timestamptz NOT NULL
    )
  `);
}
