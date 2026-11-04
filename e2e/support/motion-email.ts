/**
 * Prints the sign-in email's subject and HTML (#570), as JSON, for a Motion Script's `open-email`, with the link the app really sent, in
 * `process.argv[3]` (fr or en), as a mail client shows it. Run with tsx by e2e/motions.spec.ts: Playwright's loader cannot
 * import the translation catalogues the emails are built with (as e2e/support/email-samples.ts).
 */
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { signInEmail } from "../../apps/web/src/auth/sign-in-email";
import { withSenderAddress } from "../../apps/web/src/emails";

const [url, language] = process.argv.slice(2);
if (!url || !isSupportedLocale(language)) throw new Error("usage: motion-email.ts <link> <fr|en>");
const email = signInEmail({ url, minutes: 15 }, language);
process.stdout.write(JSON.stringify({ subject: email.subject, html: withSenderAddress(email.html, "Jobbbox <hello@jobbbox.ai>") }));
