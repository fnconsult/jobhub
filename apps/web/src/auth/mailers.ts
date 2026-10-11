import nodemailer from "nodemailer";
import type { Mailer, MailMessage } from "./index";

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
 * The mailer the environment names (see .env.example): SMTP_URL in production;
 * the console in development without it, or with MAIL_TRANSPORT=console (local
 * production builds, e2e). Fails fast in production when SMTP_URL is missing.
 */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer {
  const production = env.NODE_ENV === "production";
  if (env.MAIL_TRANSPORT === "console" || (!production && !env.SMTP_URL)) return consoleMailer();
  if (!env.SMTP_URL) throw new Error("Missing environment variable SMTP_URL");
  const from = env.MAIL_FROM || (production ? undefined : "Jobbbox <bonjour@localhost>");
  if (!from) throw new Error("Missing environment variable MAIL_FROM");
  return smtpMailer(env.SMTP_URL, from);
}
