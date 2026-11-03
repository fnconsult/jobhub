import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/** The email telling the account its Two-step verification was turned on or off (#663), dated in French time, in its Interface Language. */
export function twoStepChangeEmail({ change, at, securityUrl }: { change: "enabled" | "disabled"; at: Date; securityUrl: string }, language: Locale): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: "Europe/Paris" }).format(at);
  return renderEmail({
    language,
    subject: t(`twoStep.email.${change}Subject`),
    title: t(`twoStep.email.${change}Title`),
    body: [t(`twoStep.email.${change}Body`, { date }), t("twoStep.email.notYou"), { action: { label: t("twoStep.email.action"), url: securityUrl } }],
    footer: { reason: t("twoStep.email.reason") },
  });
}
