/**
 * What the sign-in page says around the form: the intro, and the notice shown
 * when a sign-in comes back with an error. Google is mentioned only when
 * Google sign-in is configured, so the text never offers a button that is not there.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";

export interface SignInCopy {
  intro: string;
  /** Shown as an alert above the form, or null when the page was not reached through an error. */
  notice: string | null;
}

/** Codes a dead magic link comes back with; anything else (Google, OAuth state) is a failed sign-in. */
const MAGIC_LINK_ERRORS = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

export function signInCopy({ googleEnabled, error }: { googleEnabled: boolean; error?: string }, locale: Locale): SignInCopy {
  const { t } = createI18n(locale);
  const failed = googleEnabled ? t("signIn.failed") : t("signIn.failedWithoutGoogle");
  return {
    intro: googleEnabled ? t("signIn.intro") : t("signIn.introWithoutGoogle"),
    notice: error ? (MAGIC_LINK_ERRORS.has(error) ? t("signIn.linkError") : failed) : null,
  };
}
