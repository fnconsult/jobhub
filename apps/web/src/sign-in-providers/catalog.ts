/**
 * Sign-in Providers (CONTEXT.md, #209): the identity providers, besides the magic
 * link, that Candidates and Administrators may sign in with, configured by
 * super-admins in the Back Office's Connexion section. Google, Apple and Microsoft
 * are Better Auth social providers (one each, their id is their type); any number
 * of generic OIDC providers go through Better Auth's generic OAuth plugin, each
 * under an id the super-admin picks.
 */

export const SIGN_IN_PROVIDER_TYPES = ["google", "apple", "microsoft", "oidc"] as const;
export type SignInProviderType = (typeof SIGN_IN_PROVIDER_TYPES)[number];

export const isSignInProviderType = (value: unknown): value is SignInProviderType => SIGN_IN_PROVIDER_TYPES.includes(value as SignInProviderType);

/** The social provider types: one provider each, its id is its type. */
export const SOCIAL_TYPES = ["google", "apple", "microsoft"] as const satisfies readonly SignInProviderType[];

export type SecretField = "clientSecret" | "teamId" | "keyId" | "privateKey";

/** A provider's own setting, besides its client id: one per type at most. */
export type ProviderSetting = "discoveryUrl" | "tenantId" | "appBundleIdentifier";

/**
 * Each type of Sign-in Provider, in one place: what it is called by default, the secrets the
 * Back Office asks for (kept as Provider Secrets, write-only), its own setting, whether its
 * client secret is signed by the app (Apple's, from the .p8 key: see ./apple.ts), whether
 * trusting it for linking is the super-admin's choice (OIDC) or always on, and whether its id
 * is chosen by the super-admin (OIDC: any number of them) or is its type (one each).
 */
export const PROVIDER_TYPES = {
  google: { defaultName: "Google", secretFields: ["clientSecret"], setting: null, signsClientSecret: false, trustIsAChoice: false, idIsChosen: false },
  microsoft: { defaultName: "Microsoft", secretFields: ["clientSecret"], setting: "tenantId", signsClientSecret: false, trustIsAChoice: false, idIsChosen: false },
  apple: { defaultName: "Apple", secretFields: ["teamId", "keyId", "privateKey"], setting: "appBundleIdentifier", signsClientSecret: true, trustIsAChoice: false, idIsChosen: false },
  oidc: { defaultName: "", secretFields: ["clientSecret"], setting: "discoveryUrl", signsClientSecret: false, trustIsAChoice: true, idIsChosen: true },
} as const satisfies Record<
  SignInProviderType,
  { defaultName: string; secretFields: readonly SecretField[]; setting: ProviderSetting | null; signsClientSecret: boolean; trustIsAChoice: boolean; idIsChosen: boolean }
>;

/** The secrets a provider of `type` keeps, typed in or (Apple's client secret) signed by the app. */
export const storedSecretFields = (type: SignInProviderType): readonly SecretField[] =>
  PROVIDER_TYPES[type].signsClientSecret ? [...PROVIDER_TYPES[type].secretFields, "clientSecret"] : PROVIDER_TYPES[type].secretFields;

/** Where the nonce of a test sign-in started from Connexion travels in the OAuth flow (`additionalData`). */
export const TEST_SIGN_IN = "testSignIn";

/** How a sign-in made in the app is named on its session: a provider's id, or this. */
export const MAGIC_LINK = "magic-link";

/** Error codes a refused OAuth sign-in comes back to the sign-in page with (`?error=`). */
export const SIGN_IN_ERRORS = {
  /** The provider is for Administrators only. */
  providerNotAllowed: "provider_not_allowed",
  /** A Jobbbox account has this email and the provider is not trusted for linking: sign in by magic link, then link it from Mon compte. */
  accountNotLinked: "account_not_linked",
  /** The provider is not enabled (only a super-admin's test sign-in goes through it then). */
  providerDisabled: "provider_disabled",
} as const;

/** Ids an OIDC provider may not take: the social types and the magic link. */
const RESERVED_IDS: readonly string[] = [...SOCIAL_TYPES, MAGIC_LINK, "email-password", "credential"];

/** An OIDC provider's id: lower-case letters, digits and dashes, 2 to 32 characters, starting with a letter. */
export const isValidOidcId = (id: string): boolean => /^[a-z][a-z0-9-]{1,31}$/.test(id) && !RESERVED_IDS.includes(id);

/** A Microsoft tenant open to every directory: any of its admins may set any email address on an account. */
export const isMultiTenant = (tenantId: string | undefined): boolean => ["common", "organizations"].includes((tenantId ?? "common").trim().toLowerCase());

/**
 * Where a provider sends the person back, to paste in its console. Better Auth 1.7
 * serves generic OAuth providers on the same callback as the social ones.
 */
export const callbackPath = (id: string): string => `/api/auth/callback/${encodeURIComponent(id)}`;

/** One Sign-in Provider in use, with its secrets opened. Server side only: never sent to a page. */
export interface SignInProvider {
  id: string;
  type: SignInProviderType;
  /** On the button: "Continuer avec {displayName}". */
  displayName: string;
  clientId: string;
  /** For Apple, the JWT signed with its .p8 key. */
  clientSecret: string;
  /** OIDC: the issuer's discovery document (…/.well-known/openid-configuration). */
  discoveryUrl?: string | undefined;
  /** Microsoft: common, organizations, consumers, or one tenant's id or domain. */
  tenantId?: string | undefined;
  /** Apple: the app's bundle id, for sign-in from a native app. */
  appBundleIdentifier?: string | undefined;
  /** OIDC: that discovery document, fetched (with a time limit) when the configuration was read; absent when it could not be. */
  discovery?: Record<string, unknown> | undefined;
  /** Off: nobody signs in through it; it is registered only for a test sign-in started from Connexion. */
  enabled: boolean;
  /** A super-admin started a test sign-in through it from Connexion, a few minutes ago at most. */
  testPending?: boolean | undefined;
  /** On the Candidate sign-in page. */
  shownToCandidates: boolean;
  /** Usable for Back Office sign-in. */
  allowedForAdministrators: boolean;
  /** Same email, same account: linked automatically, without the magic link first. */
  trustedForLinking: boolean;
}

/** The sign-in configuration in use: what the Better Auth instance is built from. */
export interface SignInConfiguration {
  /** Each provider complete enough to be registered (its secrets present), enabled or not. */
  providers: SignInProvider[];
  /** The Back Office asks Administrators signed in by magic link to sign in again with a provider allowed for them. */
  requireSsoForAdministrators: boolean;
  /** Changes whenever anything above does: the instance is rebuilt then. Carries no secret. */
  version: string;
}
