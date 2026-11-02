import { fillContactEmail, type LegalTextVersion } from "@jobhub/help";
import { getPlatformSettingsResolver } from "@/platform-settings/server";

/**
 * Where a Visitor or a Guest writes to the team (an error page's « Signaler un problème », #542; the public footer's
 * « Nous contacter », #544): the address Jobbbox's emails come from (MAIL_FROM), not a development one. None while
 * it is unset.
 */
export function publicContactEmail(): string | undefined {
  const from = getPlatformSettingsResolver().current().setting("MAIL_FROM")?.value.trim() ?? "";
  const address = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
  return address.includes("@") && !address.endsWith("@localhost") ? address : undefined;
}

/**
 * `shown` with the contact address written in where its text says CONTACT_EMAIL_TOKEN (the legal notice, #552): the
 * same address as « Nous contacter »'s Help Article and the public footer.
 */
export function withPublicContactEmail<T extends { version: LegalTextVersion }>(shown: T, email: string | undefined = publicContactEmail()): T {
  const { version } = shown;
  return {
    ...shown,
    version: {
      ...version,
      // The summary is shown as plain text, never as Markdown: the bare address.
      inBrief: version.inBrief.map((line) => fillContactEmail(line, email, version.locale, { plain: true })),
      sections: version.sections.map((section) => ({ ...section, body: fillContactEmail(section.body, email, version.locale) })),
    },
  };
}
