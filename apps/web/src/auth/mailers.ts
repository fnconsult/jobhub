import nodemailer from "nodemailer";
import type { Mailer, MailMessage } from "./index";

/** Sends emails through an SMTP server (an EU provider in production, ADR-0007). */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message: MailMessage) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
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
