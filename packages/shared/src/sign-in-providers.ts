/**
 * The Sign-in Providers as the web's sign-in page and the app's sign-in screen show them (#470, #687): the ones shown
 * to Candidates, read from the same answer (`GET /api/sign-in-providers`, the web page reading the same policy), what the
 * page says around them, and how a sign-in through one comes back refused (`?error=`). One copy for both, so the app
 * never offers or says what the web would not.
 */
import * as z from "zod";
import { createI18n, type Locale } from "./i18n";

/** Error codes a refused OAuth sign-in comes back to the sign-in page (or the app) with (`?error=`). */
export const SIGN_IN_ERRORS = {
  /** The provider is for Administrators only. */
  providerNotAllowed: "provider_not_allowed",
  /** A Jobbbox account has this email and the provider is not trusted for linking: sign in by magic link, then link it from Mon compte. */
  accountNotLinked: "account_not_linked",
  /** The provider is not enabled (only a super-admin's test sign-in goes through it then). */
  providerDisabled: "provider_disabled",
} as const;

/** A provider's button: « Continuer avec {displayName} ». No client id, no secret. */
export const signInProviderButtonSchema = z.object({ id: z.string().min(1), displayName: z.string().min(1) });
export type SignInProviderButton = z.infer<typeof signInProviderButtonSchema>;

/** `GET /api/sign-in-providers`: the Sign-in Providers shown to Candidates, enabled, in the Back Office's order. Public. */
export const signInProvidersResponseSchema = z.object({ providers: z.array(signInProviderButtonSchema) });
export type SignInProvidersResponse = z.infer<typeof signInProvidersResponseSchema>;

/**
 * The errors a provider sends back when the person refused or closed its page rather than signing in: Google's and
 * Microsoft's `access_denied` (OAuth 2.0), Apple's `user_cancelled_authorize`. The app takes them as a cancellation.
 */
const CANCELLED_AT_PROVIDER = new Set(["access_denied", "user_cancelled_authorize"]);

/** Whether a sign-in came back with `error` because the person left the provider's page (a cancellation, not a failure). */
export const cancelledAtProvider = (error: string): boolean => CANCELLED_AT_PROVIDER.has(error);

export interface SignInCopy {
  intro: string;
  /**
   * Shown as a Note above the form, or null when the page was not reached through an error: a warning for a sign-in
   * link that is no longer valid (ask for another), a danger for any other failed sign-in.
   */
  notice: { tone: "warn" | "danger"; text: string } | null;
}

/** Codes a dead magic link comes back with; anything else (a provider, OAuth state) is a failed sign-in. */
const MAGIC_LINK_ERRORS = new Set(["INVALID_TOKEN", "EXPIRED_TOKEN", "ATTEMPTS_EXCEEDED"]);

/**
 * What a sign-in page says around the form: the intro, and the Note shown when a sign-in comes back with an error. It
 * names only the providers whose buttons the page shows (`providers`, their display names in order), so the text never
 * offers a button that is not there.
 */
export function signInCopy({ providers, error }: { providers: readonly string[]; error?: string | undefined | null }, locale: Locale): SignInCopy {
  const { t } = createI18n(locale);
  const named = new Intl.ListFormat(locale, { type: "disjunction" }).format(providers);
  const failure = (): string => {
    if (error === SIGN_IN_ERRORS.accountNotLinked) return t("signIn.accountNotLinked");
    if (error === SIGN_IN_ERRORS.providerNotAllowed) return t("signIn.providerNotAllowed");
    if (error === SIGN_IN_ERRORS.providerDisabled) return t("signIn.providerDisabled");
    return providers.length > 0 ? t("signIn.failed", { providers: named }) : t("signIn.failedWithoutProviders");
  };
  return {
    intro: providers.length > 0 ? t("signIn.intro", { providers: named }) : t("signIn.introWithoutProviders"),
    notice: !error ? null : MAGIC_LINK_ERRORS.has(error) ? { tone: "warn", text: t("signIn.linkError") } : { tone: "danger", text: failure() },
  };
}
