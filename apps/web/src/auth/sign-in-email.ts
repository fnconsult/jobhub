import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/**
 * The sign-in email (magic link): its link as the one button, then its code (#686) in plain digits, which iOS offers to
 * fill in; both valid `minutes` and once.
 */
export function signInEmail({ url, code, minutes }: { url: string; code: string; minutes: number }, language: Locale): RenderedEmail {
  const { t } = createI18n(language);
  return renderEmail({
    language,
    subject: t("signInEmail.subject"),
    title: t("signInEmail.title"),
    body: [{ action: { label: t("signInEmail.action"), url } }, t("signInEmail.code", { code }), t("signInEmail.validity", { minutes }), t("signInEmail.ignore")],
    footer: { reason: t("signInEmail.reason") },
  });
}
