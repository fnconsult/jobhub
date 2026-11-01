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
