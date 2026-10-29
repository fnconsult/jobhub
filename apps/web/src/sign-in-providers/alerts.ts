import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";
import { routes } from "../routes";

/** Why Apple's client secret could not be signed again. */
export type AppleFailureReason = "missing_secret" | "invalid_apple_key" | "no_master_key";

/**
 * The email the super-admins get when the worker could not sign Apple's client secret
 * again: the sign-in with Apple stops working when the one in use expires. In French by
 * default, the Jobbbox team's language. Names no secret.
 */
export function appleFailureEmail(failed: readonly { id: string; reason: AppleFailureReason }[], appUrl: string, language: Locale = "fr"): RenderedEmail {
  const { t } = createI18n(language);
  return renderEmail({
    language,
    subject: t("appleAlert.subject"),
    title: t("appleAlert.title"),
    body: [
      t("appleAlert.intro"),
      ...failed.map(({ id, reason }) => ({ card: { title: id, details: [t(`appleAlert.reasons.${reason}`)] } })),
      t("appleAlert.outro"),
      { action: { label: t("appleAlert.action"), url: new URL(routes.adminSignInProviders, appUrl).toString() } },
    ],
    footer: { reason: t("emails.reasons.superAdmin") },
  });
}
