/**
 * Where a person without an account writes to the team (ADR-0035: no support mailbox): the address of the legal notice.
 * A Help Article (« Nous contacter », #552) or a Legal Text Version writes CONTACT_EMAIL_TOKEN where the address goes,
 * never the address itself; the page fills it in with `fillContactEmail`, from the one address the app knows (MAIL_FROM,
 * read by the web app's `publicContactEmail`), so the article, the legal notice, the error pages and the public footer
 * always give the same one. Pure: the browser bundles it too.
 *
 *   fillContactEmail("Écrivez à {{contact-email}}.", "bonjour@jobbbox.fr", "fr"); // "Écrivez à [bonjour@jobbbox.fr](mailto:bonjour@jobbbox.fr)."
 */
import type { HelpLocale } from "./types";

/** What an article or a Legal Text Version writes where the contact address goes. */
export const CONTACT_EMAIL_TOKEN = "{{contact-email}}";

/** What stands for the address while none is set (outside production): the reader is sent to the legal notice. */
const NO_ADDRESS: Record<HelpLocale, string> = {
  fr: "l'adresse indiquée dans les mentions légales",
  en: "the address given in the legal notice",
};

/**
 * `text` with each CONTACT_EMAIL_TOKEN replaced by `email` as a mailto link (`plain`: the bare address, for a text
 * shown without Markdown), or, without one, by words sending the reader to the legal notice.
 */
export function fillContactEmail(text: string, email: string | undefined, locale: HelpLocale, { plain = false }: { plain?: boolean } = {}): string {
  const address = email?.trim();
  const shown = !address ? NO_ADDRESS[locale] : plain ? address : `[${address}](mailto:${address})`;
  return text.split(CONTACT_EMAIL_TOKEN).join(shown);
}
