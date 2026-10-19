import nodemailer from "nodemailer";
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

/** Sends emails through Brevo's transactional email API, with an API key (xkeysib-…). */
export function brevoApiMailer(apiKey: string, from: string, options: { apiUrl?: string; fetch?: typeof globalThis.fetch } = {}): Mailer {
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

/** Sends emails through an SMTP server (an EU provider in production, ADR-0007). */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
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

/**
 * The mailer the environment names (see .env.example): Brevo's API with BREVO_API_KEY,
 * else SMTP_URL; the console in development without either, or with MAIL_TRANSPORT=console
 * (local production builds, e2e). Fails fast in production when both are missing.
 */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer {
  const production = env.NODE_ENV === "production";
  const brevoApiKey = env.BREVO_API_KEY?.trim();
  if (env.MAIL_TRANSPORT === "console" || (!production && !brevoApiKey && !env.SMTP_URL)) return consoleMailer();
  if (!brevoApiKey && !env.SMTP_URL) throw new Error("Missing environment variable BREVO_API_KEY or SMTP_URL");
  const from = env.MAIL_FROM || (production ? undefined : "Jobbbox <bonjour@localhost>");
  if (!from) throw new Error("Missing environment variable MAIL_FROM");
  if (brevoApiKey) return brevoApiMailer(brevoApiKey, from, { apiUrl: env.BREVO_API_URL });
  return smtpMailer(env.SMTP_URL!, from);
}
