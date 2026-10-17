/**
 * What a sign-in page says around the form: the intro, and the notice shown when a
 * sign-in comes back with an error. It names only the providers whose buttons the page
 * shows, so the text never offers a button that is not there.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { SIGN_IN_ERRORS } from "../sign-in-providers/catalog";

export interface SignInCopy {
  intro: string;
  /** Shown as an alert above the form, or null when the page was not reached through an error. */
  notice: string | null;
}

/** Codes a dead magic link comes back with; anything else (a provider, OAuth state) is a failed sign-in. */
const MAGIC_LINK_ERRORS = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

/** `providers`: the display names of the provider buttons on the page, in order. */
export function signInCopy({ providers, error }: { providers: readonly string[]; error?: string | undefined }, locale: Locale): SignInCopy {
  const { t } = createI18n(locale);
  const named = new Intl.ListFormat(locale, { type: "disjunction" }).format(providers);
  const notice = (): string => {
    if (MAGIC_LINK_ERRORS.has(error!)) return t("signIn.linkError");
    if (error === SIGN_IN_ERRORS.accountNotLinked) return t("signIn.accountNotLinked");
    if (error === SIGN_IN_ERRORS.providerNotAllowed) return t("signIn.providerNotAllowed");
    return providers.length > 0 ? t("signIn.failed", { providers: named }) : t("signIn.failedWithoutProviders");
  };
  return {
    intro: providers.length > 0 ? t("signIn.intro", { providers: named }) : t("signIn.introWithoutProviders"),
    notice: error ? notice() : null,
  };
}
