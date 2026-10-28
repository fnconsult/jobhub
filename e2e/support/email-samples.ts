/**
 * Prints the seven emails' HTML (#472), rendered from their samples in `process.argv[2]` (fr by default) with the
 * sender's address a mailer writes in, as JSON { name: html }. Run with tsx by e2e/email-html.spec.ts: Playwright's
 * loader cannot import the translation catalogues the emails are built with.
 */
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { withSenderAddress } from "../../apps/web/src/emails";
import { sampleEmails } from "../../apps/web/src/emails/samples";

const language = isSupportedLocale(process.argv[2]) ? process.argv[2] : "fr";
const emails = sampleEmails(language);
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(emails).map(([name, { html }]) => [name, withSenderAddress(html, "Jobbbox <hello@jobbbox.ai>")]))));
