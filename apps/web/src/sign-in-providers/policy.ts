/**
 * What the sign-in configuration allows (CONTEXT.md: Sign-in Provider). Pure: every
 * answer is read from a `SignInConfiguration`, which the Better Auth instance, the
 * sign-in pages and the Back Office guard share.
 */
import { isMultiTenant, MAGIC_LINK, type SignInConfiguration, type SignInProvider } from "./catalog";

/** Who a sign-in page is for. */
export type SignInAudience = "candidates" | "administrators";

/** A provider's button on a sign-in page: no client id, no secret. */
export interface SignInButton {
  id: string;
  displayName: string;
}

const usableBy = (provider: SignInProvider, audience: SignInAudience): boolean =>
  provider.enabled && (audience === "candidates" ? provider.shownToCandidates : provider.allowedForAdministrators);

/** The providers a sign-in page offers: enabled, and shown to Candidates or allowed for Administrators. */
export function signInButtons(configuration: SignInConfiguration, audience: SignInAudience): SignInButton[] {
  return configuration.providers.filter((provider) => usableBy(provider, audience)).map(({ id, displayName }) => ({ id, displayName }));
}

/**
 * What to do with a person coming back from provider `providerId`:
 *  - allow:  sign them in (or up, or link it);
 *  - test:   the provider is not enabled yet, this is the Back Office's test sign-in:
 *            it worked, and nothing is created, nobody is signed in;
 *  - refuse: not usable by this person (a provider for Administrators only, or unknown).
 */
export function oauthSignInDecision(configuration: SignInConfiguration, providerId: string, person: { isAdministrator: boolean }): "allow" | "test" | "refuse" {
  const provider = configuration.providers.find((candidate) => candidate.id === providerId);
  if (!provider) return "refuse";
  if (!provider.enabled) return "test";
  if (provider.shownToCandidates) return "allow";
  return provider.allowedForAdministrators && person.isAdministrator ? "allow" : "refuse";
}

/**
 * Whether a provider's email address can be taken as proof of owning the Jobbbox
 * account with it. Microsoft on a multi-tenant directory never is: any tenant's
 * admin may set any address on one of their accounts.
 */
const trustworthy = (provider: SignInProvider): boolean => provider.trustedForLinking && !(provider.type === "microsoft" && isMultiTenant(provider.tenantId));

/** The ids Better Auth links by email automatically (`accountLinking.trustedProviders`). */
export function trustedProviderIds(configuration: SignInConfiguration): string[] {
  return configuration.providers.filter((provider) => provider.enabled && trustworthy(provider)).map((provider) => provider.id);
}

/**
 * Whether the Back Office must ask this Administrator to sign in again with a provider
 * allowed for Administrators (Require SSO for Administrators). `signInMethod` is how their
 * session was signed in: a provider id, MAGIC_LINK, or null when unknown.
 */
export function needsSsoForBackOffice(configuration: SignInConfiguration, session: { signInMethod: string | null; permanentSuperAdmin: boolean }): boolean {
  if (!configuration.requireSsoForAdministrators || session.permanentSuperAdmin) return false;
  if (!session.signInMethod || session.signInMethod === MAGIC_LINK) return true;
  return !signInButtons(configuration, "administrators").some((button) => button.id === session.signInMethod);
}

/** One generic OAuth provider, as Better Auth's plugin takes it. */
export interface GenericOAuthProvider {
  providerId: string;
  name: string;
  clientId: string;
  clientSecret: string;
  discoveryUrl: string;
  scopes: string[];
  /** Refuse an ID token that does not check against the issuer's keys. */
  requireIdTokenVerification: boolean;
}

/** The social providers, as Better Auth's `socialProviders` takes them. */
export interface SocialProviders {
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string; tenantId: string };
  apple?: { clientId: string; clientSecret: string; appBundleIdentifier?: string };
}

/** Apple posts the person back from its own origin (form_post). */
export const APPLE_ORIGIN = "https://appleid.apple.com";

/**
 * What the Better Auth instance registers: the enabled providers, and one not enabled while
 * a test sign-in started from Connexion is pending (see oauthSignInDecision). An OIDC provider
 * is registered only if its discovery document was fetched in time when the configuration was
 * read: an issuer that does not answer is left out rather than stall the instance's start.
 */
export function betterAuthSignIn(configuration: SignInConfiguration): {
  socialProviders: SocialProviders;
  genericOAuth: GenericOAuthProvider[];
  trustedOrigins: string[];
} {
  const socialProviders: SocialProviders = {};
  const genericOAuth: GenericOAuthProvider[] = [];
  for (const provider of configuration.providers.filter((candidate) => candidate.enabled || candidate.testPending)) {
    const { clientId, clientSecret } = provider;
    switch (provider.type) {
      case "google":
        socialProviders.google = { clientId, clientSecret };
        break;
      case "microsoft":
        socialProviders.microsoft = { clientId, clientSecret, tenantId: provider.tenantId?.trim() || "common" };
        break;
      case "apple":
        socialProviders.apple = { clientId, clientSecret, ...(provider.appBundleIdentifier ? { appBundleIdentifier: provider.appBundleIdentifier } : {}) };
        break;
      case "oidc":
        if (provider.discovery && provider.discoveryUrl) {
          genericOAuth.push({
            providerId: provider.id,
            name: provider.displayName,
            clientId,
            clientSecret,
            discoveryUrl: provider.discoveryUrl,
            scopes: ["openid", "email", "profile"],
            requireIdTokenVerification: true,
          });
        }
        break;
    }
  }
  return { socialProviders, genericOAuth, trustedOrigins: socialProviders.apple ? [APPLE_ORIGIN] : [] };
}
