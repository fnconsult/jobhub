/**
 * The seven emails, each built by its own module from fixed sample data: what the both-languages test
 * (seven-emails.test.ts) and the screenshot baselines (e2e/email-html.spec.ts) render.
 */
import type { Locale } from "@jobhub/shared/i18n";
import { signInEmail } from "../auth/sign-in-email";
import type { RenderedEmail } from "./index";

export const EMAIL_NAMES = ["signIn"] as const;
export type EmailName = (typeof EMAIL_NAMES)[number];

const APP_URL = "https://app.jobbbox.fr";

/** Each of the seven emails in `language`, from sample data. */
export function sampleEmails(language: Locale): Record<EmailName, RenderedEmail> {
  return {
    signIn: signInEmail({ url: `${APP_URL}/api/auth/magic-link/verify?token=abc`, minutes: 15 }, language),
  };
}
