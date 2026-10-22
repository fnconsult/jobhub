import { recordingClient, recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import nodemailer from "nodemailer";
import type { PlatformSettingsResolver } from "../platform-settings/resolver";
import { secretsWithSettings } from "../platform-settings/secrets-with-settings";
import { MAIL_SECRET_NAMES } from "../provider-secrets/catalog";
import { liveObject, type SecretResolver } from "../provider-secrets/resolver";
import type { Mailer, MailMessage } from "./index";

/** Brevo's transactional email API (EU provider, ADR-0007). BREVO_API_URL overrides it (e2e). */
const BREVO_API_URL = "https://api.brevo.com/v3";

/** An HTTP error from Brevo, carrying its status: a 401 is a refused key (provider-secrets/resolver.ts). */
export class BrevoApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Brevo API: HTTP ${status} ${detail}`.trim());
    this.name = "BrevoApiError";
  }
}

/** "Jobbbox <bonjour@jobbbox.fr>" → its name and address; a bare address has no name. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const [, rawName = "", rawEmail = ""] = match;
  const name = rawName.trim();
  return name ? { name, email: rawEmail.trim() } : { email: rawEmail.trim() };
}

/** An email address as a sender takes it: one address, no spaces, no list separators. */
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\].][^\s@<>()",;:\\[\]]*$/;

/**
 * Whether `from` names one sender our mailers can send as (MAIL_FROM): "hello@jobbbox.ai",
 * "Jobbbox <hello@jobbbox.ai>" or '"Jobbbox" <hello@jobbbox.ai>'. Never a list, never a line break
 * (no header slipped in after it).
 */
export function isSender(from: string): boolean {
  const value = from.trim();
  if (/[\r\n]/.test(value)) return false;
  const named = /^(?:"[^"\\]*"|[^"<>,;]*?)\s*<([^<>]*)>$/.exec(value);
  return ADDRESS.test(named ? named[1]! : value);
}

/** Sends emails through Brevo's transactional email API, with an API key (xkeysib-…). */
export function brevoApiMailer(apiKey: string, from: string, options: { apiUrl?: string; fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}): Mailer {
  const fetch = options.fetch ?? globalThis.fetch;
  const apiUrl = (options.apiUrl?.trim() || BREVO_API_URL).replace(/\/$/, "");
  const sender = parseSender(from);
  return {
    async send(message: MailMessage) {
      const response = await fetch(`${apiUrl}/smtp/email`, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          ...(message.headers ? { headers: message.headers } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new BrevoApiError(response.status, (await response.text().catch(() => "")).slice(0, 200));
    },
  };
}

/** What an SMTP mailer sends through: nodemailer's transport, by default. */
export type SmtpTransport = { sendMail(mail: { from: string; to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<unknown> };

/** Sends emails through an SMTP server (an EU provider in production, ADR-0007). */
export function smtpMailer(smtpUrl: string, from: string, transport: SmtpTransport = nodemailer.createTransport(smtpUrl)): Mailer {
  return {
    async send(message: MailMessage) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text, headers: message.headers });
    },
  };
}

/** Development only: prints emails (and their sign-in links) to the server console. */
export function consoleMailer(): Mailer {
  return {
    async send(message: MailMessage) {
      console.info(`[mail] to ${message.to}: ${message.subject}\n${message.text}`);
    },
  };
}

export interface MailerOptions {
  /** Where each email sent is recorded (#234): one call to Brevo, never who it was for nor what it said. Default: nowhere. */
  externalApis?: ExternalApiLog;
  /** What SMTP_URL is sent through. Default: nodemailer's transport to it. */
  smtpTransport?: SmtpTransport;
}

/** The sender outside production when MAIL_FROM is not set (production requires it): the code's default of MAIL_FROM. */
export const DEVELOPMENT_MAIL_FROM = "Jobbbox <bonjour@localhost>";

/**
 * The mailer the environment names (see .env.example): Brevo's API with BREVO_API_KEY,
 * else SMTP_URL; the console in development without either, or with MAIL_TRANSPORT=console
 * (local production builds, e2e). Fails fast in production when both are missing.
 */
export function mailerFromEnv(env: Record<string, string | undefined>, options: MailerOptions = {}): Mailer {
  const production = env.NODE_ENV === "production";
  const brevoApiKey = env.BREVO_API_KEY?.trim();
  if (env.MAIL_TRANSPORT === "console" || (!production && !brevoApiKey && !env.SMTP_URL)) return consoleMailer();
  if (!brevoApiKey && !env.SMTP_URL) throw new Error("Missing environment variable BREVO_API_KEY or SMTP_URL");
  const from = env.MAIL_FROM || (production ? undefined : DEVELOPMENT_MAIL_FROM);
  if (!from) throw new Error("Missing environment variable MAIL_FROM");
  const { externalApis } = options;
  if (brevoApiKey) {
    const fetch = externalApis ? recordingFetch((url: string, init?: RequestInit) => globalThis.fetch(url, init), externalApis, { provider: "brevo", operation: () => "send" }) : undefined;
    return brevoApiMailer(brevoApiKey, from, { apiUrl: env.BREVO_API_URL, fetch });
  }
  const smtp = smtpMailer(env.SMTP_URL!, from, options.smtpTransport);
  return externalApis ? recordingClient(smtp, externalApis, { provider: "brevo_smtp", answeredStatus: null }) : smtp;
}

/** What the mailers are built from: Brevo's key or SMTP relay (Provider Secrets), and the sender (a Platform Setting). */
export const MAILER_NAMES = [...MAIL_SECRET_NAMES, "MAIL_FROM"] as const;

/**
 * The web app's and the worker's mailer (`mailerFromEnv`), built from the Provider Secrets and the
 * Platform Settings in use, and rebuilt when one it reads changes: a key replaced in Clés or a
 * `MAIL_FROM` saved on Paramètres is used by the next email, without a restart (#300).
 * A mailer that cannot be built (production with no sender anywhere) fails the email it was asked to send.
 */
export function liveMailer(sources: { secrets: SecretResolver; settings: PlatformSettingsResolver }, options: MailerOptions = {}): Mailer {
  return liveObject(secretsWithSettings(sources.secrets, sources.settings), MAILER_NAMES, (env) => mailerFromEnv(env, options));
}
