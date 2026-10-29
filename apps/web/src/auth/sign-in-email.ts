import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/** The sign-in email (magic link): its link as the one button, valid `minutes` and once. */
export function signInEmail({ url, minutes }: { url: string; minutes: number }, language: Locale): RenderedEmail {
  const { t } = createI18n(language);
  return renderEmail({
    language,
    subject: t("signInEmail.subject"),
    title: t("signInEmail.title"),
    body: [{ action: { label: t("signInEmail.action"), url } }, t("signInEmail.validity", { minutes }), t("signInEmail.ignore")],
    footer: { reason: t("signInEmail.reason") },
  });
}
