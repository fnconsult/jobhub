/**
 * What the sign-in configuration allows (CONTEXT.md: Sign-in Provider). Pure: every
 * answer is read from a `SignInConfiguration`, which the Better Auth instance, the
 * sign-in pages and the Back Office guard share.
 */
import { isMultiTenant, MAGIC_LINK, type SignInConfiguration, type SignInProvider, type SignInProviderType } from "./catalog";

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

/** The providers a person may sign in with, so link from Mon compte: those shown to Candidates, and an Administrator's own, each once. */
export function linkableProviders(configuration: SignInConfiguration, person: { isAdministrator: boolean }): SignInButton[] {
  const candidates = signInButtons(configuration, "candidates");
  if (!person.isAdministrator) return candidates;
  const ids = new Set(candidates.map((button) => button.id));
  return [...candidates, ...signInButtons(configuration, "administrators").filter((button) => !ids.has(button.id))];
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
 * Whether a provider's email address is taken as proof of owning the Jobbbox account with it
 * (it links by email). Microsoft on a multi-tenant directory never is: any tenant's admin may
 * set any address on one of their accounts.
 */
export const linksByEmail = (provider: Pick<SignInProvider, "type" | "trustedForLinking"> & { tenantId?: string | null | undefined }): boolean =>
  provider.trustedForLinking && !(provider.type === "microsoft" && isMultiTenant(provider.tenantId ?? undefined));

/** The ids Better Auth links by email automatically (`accountLinking.trustedProviders`). */
export function trustedProviderIds(configuration: SignInConfiguration): string[] {
  return configuration.providers.filter((provider) => provider.enabled && linksByEmail(provider)).map((provider) => provider.id);
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

/** How each type of provider is registered with Better Auth. */
const REGISTER: Record<SignInProviderType, (provider: SignInProvider, into: { socialProviders: SocialProviders; genericOAuth: GenericOAuthProvider[] }) => void> = {
  google: ({ clientId, clientSecret }, into) => void (into.socialProviders.google = { clientId, clientSecret }),
  microsoft: ({ clientId, clientSecret, tenantId }, into) => void (into.socialProviders.microsoft = { clientId, clientSecret, tenantId: tenantId?.trim() || "common" }),
  apple: ({ clientId, clientSecret, appBundleIdentifier }, into) =>
    void (into.socialProviders.apple = { clientId, clientSecret, ...(appBundleIdentifier ? { appBundleIdentifier } : {}) }),
  oidc: (provider, into) => {
    if (!provider.discovery || !provider.discoveryUrl) return;
    into.genericOAuth.push({
      providerId: provider.id,
      name: provider.displayName,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      discoveryUrl: provider.discoveryUrl,
      scopes: ["openid", "email", "profile"],
      requireIdTokenVerification: true,
    });
  },
};

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
  const built = { socialProviders: {} as SocialProviders, genericOAuth: [] as GenericOAuthProvider[] };
  for (const provider of configuration.providers.filter((candidate) => candidate.enabled || candidate.testPending)) REGISTER[provider.type](provider, built);
  return { ...built, trustedOrigins: built.socialProviders.apple ? [APPLE_ORIGIN] : [] };
}
