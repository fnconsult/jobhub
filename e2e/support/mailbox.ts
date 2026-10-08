import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

export type Email = { to: string; subject: string; text: string };

/** Emails the e2e web server printed (MAIL_TRANSPORT=console) to its log, oldest first. */
export function emailsTo(address: string): Email[] {
  return emailsIn(readFileSync(process.env.E2E_SERVER_LOG!, "utf8"), address);
}

/** Emails to `address` a process printed to `log` with MAIL_TRANSPORT=console (the worker's output, say), oldest first. */
export function emailsIn(log: string, address: string): Email[] {
  return log
    .split(/^(?=\[mail\] to )/m)
    .filter((block) => block.startsWith(`[mail] to ${address}: `))
    .map((block) => {
      const [first, ...rest] = block.split("\n");
      return { to: address, subject: first!.slice(`[mail] to ${address}: `.length), text: rest.join("\n") };
    });
}

/** Waits for email number `index` (0-based) sent to `address`. */
export async function waitForEmail(address: string, index = 0): Promise<Email> {
  await expect.poll(() => emailsTo(address).length, { message: `email #${index + 1} to ${address}` }).toBeGreaterThan(index);
  return emailsTo(address)[index]!;
}

/** The sign-in link inside an email. */
export function linkIn(email: Email): string {
  const match = email.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link in email: ${email.text}`);
  return match[0];
}

/** A fresh address, so each test meets a brand-new person. */
export function newAddress(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.fr`;
}
