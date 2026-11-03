import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/** What happened to the account's Two-step verification: turned on or off (#663), or reset by a super-admin (#665). */
export type TwoStepChange = "enabled" | "disabled" | "reset";

/** The email telling the account its Two-step verification changed, dated in French time, in its Interface Language. */
export function twoStepChangeEmail({ change, at, securityUrl }: { change: TwoStepChange; at: Date; securityUrl: string }, language: Locale): RenderedEmail {
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
