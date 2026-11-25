/**
 * The daily « Quota atteint » email (#1117, decisions #1112): once a Tool is « limite atteinte » or « quota épuisé » in
 * a day (Paris time), every Administrator, whatever their roles, gets one email in their Interface Language, at most one
 * a day. It lists each Tool whose quota is still reached when it is sent, its state and since when, with the « Quota
 * atteint » banner's two links (its configuration, when the Administrator may open it, and its provider's billing
 * page, as Paramètres sets it when it is sent, #1123). No email when a quota is available again, and nothing else is sent.
 *
 *   const alert = createToolQuotaAlert({ store: postgresToolQuotaAlertStore(database), states: (now) => toolQuotaStates(database, now), settings, administrators, mailer, appUrl });
 *   await alert.check(); // { day: "2026-11-25", tools: ["openai"], outcome: "none" | "sent" | "already_sent" }
 *
 * The day is claimed before its emails are sent, and given back when sending fails, so the next check tries again:
 * never two emails the same day. Nothing personal is kept: the day, the Tools it listed, when it was sent.
 */
import { parisDay, type Tool } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import { backOfficeAccess } from "../admin/access";
import type { AdministratorRecipient } from "../admin/administrators";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";
import type { Mailer } from "../auth/index";
import { renderEmail, type EmailBlock, type RenderedEmail } from "../emails";
import { quotaBannerLines, type QuotaBannerLine } from "../quota-banner/index";
import type { ToolQuotaState } from "../tool-quotas/index";

/** A day's alert, once taken. */
export interface ToolQuotaAlertClaim {
  /** "2026-11-25", Paris time. */
  day: string;
  /** The Tools it lists, by id. */
  tools: string[];
  at: Date;
}

/** Where the days' alerts are kept. */
export interface ToolQuotaAlertStore {
  /** Takes the day's alert: true the first time, false once it was taken. */
  claim(alert: ToolQuotaAlertClaim): Promise<boolean>;
  /** Gives the day's alert back, its emails not sent. */
  release(day: string): Promise<void>;
}

export interface ToolQuotaAlertCheck {
  /** "2026-11-25", Paris time. */
  day: string;
  /** The Tools whose quota is reached now, by id, in the catalog's order. */
  tools: Tool["id"][];
  /** none: no quota reached; sent: just emailed; already_sent: emailed earlier today. */
  outcome: "none" | "sent" | "already_sent";
}

export interface ToolQuotaAlertOptions {
  store: ToolQuotaAlertStore;
  /** Each Tool's quota state at `now` (`toolQuotaStates`). */
  states: (now: Date) => Promise<readonly ToolQuotaState[]>;
  /** The Platform Settings in use when it is sent: each Tool's billing page (#1123). */
  settings: () => Pick<PlatformSettingsSnapshot, "setting">;
  /** Who is emailed: every Administrator (`administratorRecipients`). */
  administrators: () => Promise<readonly AdministratorRecipient[]>;
  mailer: Pick<Mailer, "send">;
  /** The Back Office's address, for the links to configure each Tool. */
  appUrl: string;
  now?: () => Date;
}

export interface ToolQuotaAlert {
  /** Emails every Administrator once a Tool's quota is reached, once a day. Rejects when the emails could not be sent. */
  check(): Promise<ToolQuotaAlertCheck>;
}

/** Whoever may open everything: who reads which Tools are reached, whatever links each Administrator gets. */
const EVERYTHING = backOfficeAccess(["super-admin"]);

export function createToolQuotaAlert(options: ToolQuotaAlertOptions): ToolQuotaAlert {
  return {
    async check() {
      const at = (options.now ?? (() => new Date()))();
      const day = parisDay(at);
      const states = await options.states(at);
      const settings = options.settings();
      const tools = quotaBannerLines(states, EVERYTHING, settings).map((line) => line.toolId);
      if (tools.length === 0) return { day, tools, outcome: "none" };
      if (!(await options.store.claim({ day, tools, at }))) return { day, tools, outcome: "already_sent" };
      try {
        for (const administrator of await options.administrators()) {
          const lines = quotaBannerLines(states, backOfficeAccess(administrator.roles), settings);
          await options.mailer.send({ to: administrator.email, ...toolQuotaAlertEmail(lines, options.appUrl, administrator.language) });
        }
      } catch (error) {
        await options.store.release(day);
        throw error;
      }
      return { day, tools, outcome: "sent" };
    },
  };
}

/**
 * The email an Administrator gets, in `language`: each Tool of `lines` (the « Quota atteint » banner's, for that
 * Administrator), its state and since when, Paris time, with a link to configure it (when they may) and one to its
 * provider's billing page.
 */
export function toolQuotaAlertEmail(lines: readonly QuotaBannerLine[], appUrl: string, language: Locale = "fr"): RenderedEmail {
  const { t } = createI18n(language);
  const date = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const tools = new Intl.ListFormat(language, { type: "conjunction" }).format(lines.map((line) => line.toolName));
  const toolBlocks = lines.flatMap((line): EmailBlock[] => {
    const words = { tool: line.toolName, state: t(`admin.quotaBanner.states.${line.state}`) };
    return [
      line.since ? t("admin.quotaBanner.line", { ...words, since: date.format(line.since) }) : t("admin.quotaBanner.lineNoSince", words),
      ...(line.configHref ? [{ link: { label: t("admin.quotaBanner.configure", { tool: line.toolName }), url: new URL(line.configHref, appUrl).toString() } }] : []),
      { link: { label: t("admin.quotaBanner.billing", { tool: line.toolName }), url: line.billingUrl } },
    ];
  });
  return renderEmail({
    language,
    subject: t("toolQuotaAlert.subject", { tools }),
    title: t("toolQuotaAlert.title"),
    body: [t("toolQuotaAlert.intro"), ...toolBlocks, t("toolQuotaAlert.last")],
    footer: { reason: t("emails.reasons.administrator") },
  });
}

/** The days' alerts, in `tool_quota_alert`. */
export function postgresToolQuotaAlertStore(database: Pick<Pool, "query">): ToolQuotaAlertStore {
  return {
    async claim(alert) {
      const { rowCount } = await database.query(`INSERT INTO tool_quota_alert (day, tools, sent_at) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING`, [
        alert.day,
        alert.tools,
        alert.at,
      ]);
      return rowCount === 1;
    },
    async release(day) {
      await database.query(`DELETE FROM tool_quota_alert WHERE day = $1`, [day]);
    },
  };
}

/** Creates the table of the days' alerts: no Candidate, nothing personal. Safe to run repeatedly. */
export async function migrateToolQuotaAlerts(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS tool_quota_alert (
      -- "2026-11-25", Paris time: one email a day at most.
      day text PRIMARY KEY,
      -- The Tools it listed, by id.
      tools text[] NOT NULL,
      sent_at timestamptz NOT NULL
    )
  `);
}
