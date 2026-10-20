/**
 * Candidate accounts: passwordless sign-up / sign-in (magic link, and the Sign-in
 * Providers configured in the Back Office, ADR-0008 / #209) and the Candidate's
 * account settings.
 *
 * One deep module in front of Better Auth. Callers get:
 *  - `createAuth(config)` — an instance whose `handler(Request)` serves every
 *    `/api/auth/*` endpoint and whose `api` reads sessions server-side;
 *  - `migrateCandidateAccounts(config)` — creates / upgrades the tables.
 * Everything else (tables, cookies, tokens, OAuth) stays behind this seam.
 *
 * An instance is built from one SignInConfiguration; when it changes, the app builds
 * another over the same tables and secret, so every session stays valid (server.ts).
 * Who may sign in through which provider, which ones link by email, and how each
 * session was signed in are decided here, on every OAuth callback (see signInHooks).
 */
import { createI18n, DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getOAuthState } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import type { Pool } from "pg";
import * as z from "zod";
import { routes } from "../routes";
import { withDiscoveryDocuments } from "./discovery-documents";
import { MAGIC_LINK, SIGN_IN_ERRORS, TEST_SIGN_IN, type SignInConfiguration } from "../sign-in-providers/catalog";
import { betterAuthSignIn, oauthSignInDecision, trustedProviderIds } from "../sign-in-providers/policy";

/** An email ready to send. Plain text keeps it readable in every mail client. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe (RFC 8058) on a recurring email. */
  headers?: Record<string, string>;
}

/** Delivers emails. Adapters: Brevo's API or SMTP in production, console in development, a mailbox in tests. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** A person signing in, as the sign-in decisions see them. */
export interface SigningInPerson {
  /** Their Candidate id; empty for a person signing up. */
  id: string;
  email: string;
  emailVerified: boolean;
}

/** The Sign-in Providers an instance is built with, and who counts as an Administrator. */
export interface SignInSetup {
  /** What the instance registers (built once from it). */
  configuration: SignInConfiguration;
  /**
   * The configuration in use now, which every sign-in decision (enabled, who may use it, trust
   * for linking) is read from, whatever instance serves the request: a provider disabled or
   * untrusted since is refused at once. Default: `configuration`.
   */
  current?(): SignInConfiguration;
  /** Whether `person` may use the providers allowed for Administrators (holds a Back Office Role, or is in ADMIN_EMAILS). */
  isAdministrator(person: SigningInPerson): Promise<boolean>;
  /**
   * A sign-in through provider `providerId`, not enabled yet, came back with `nonce`: true when it
   * is the test sign-in a super-admin started from Connexion (the provider is then marked tested,
   * in the Back Office Audit); false for anything else, refused.
   */
  completeTestSignIn?(providerId: string, nonce: string): Promise<boolean>;
}

export interface AuthConfig {
  /** Postgres pool. Its search_path decides which schema holds the accounts. */
  database: Pool;
  /** Public origin of the web app, e.g. https://app.jobbbox.fr */
  baseURL: string;
  /** At least 32 random characters; signs session cookies. */
  secret: string;
  mailer: Mailer;
  /** The Sign-in Providers besides the magic link. Without it, the magic link alone. */
  signIn?: SignInSetup | undefined;
  /**
   * Origins of our browser extension builds (chrome-extension://<id>). They
   * share the web app's session, so they may act for the signed-in Candidate.
   */
  extensionOrigins?: string[] | undefined;
}

/** How long a magic link stays valid. */
export const MAGIC_LINK_MINUTES = 15;

const NO_SIGN_IN: SignInSetup = { configuration: { providers: [], requireSsoForAdministrators: false, version: "none" }, isAdministrator: async () => false };

/** The endpoint context a database hook runs in (null outside an endpoint). */
type HookContext = {
  path?: string;
  params?: Record<string, string | undefined>;
  redirect(url: string): unknown;
  context: { internalAdapter: { findUserById(id: string): Promise<{ id: string; email: string; emailVerified: boolean } | null> } };
} | null;

/** The OAuth flow's state on this request (parsed from the provider's redirect on a callback); null outside one. */
async function currentOAuthState(): Promise<Record<string, unknown> | null> {
  try {
    return ((await getOAuthState()) as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

/** The provider a hook runs for: the one whose OAuth callback this is, if any. */
const providerOf = (ctx: HookContext): string | null => (ctx?.path?.startsWith("/callback/") ? (ctx.params?.id ?? null) : null);

/**
 * Better Auth's database hooks that apply the sign-in policy (sign-in-providers/policy.ts)
 * on every OAuth callback, before anything is created:
 *  - a provider not shown to Candidates signs in Administrators only (provider_not_allowed);
 *  - through a provider not enabled, only the test sign-in a super-admin started from Connexion
 *    goes (its nonce, checked by completeTestSignIn): it is marked as passed and the super-admin
 *    is sent back to the Connexion section, nothing created; anything else is provider_disabled;
 *  - linking to an existing account by email happens only through a provider trusted for
 *    linking (account_not_linked otherwise), or when the Candidate links it themselves,
 *    signed in, from Mon compte;
 *  - each session records how it was signed in (`signInMethod`), for Require SSO.
 */
export function signInHooks(signIn: SignInSetup, baseURL: string) {
  /** The configuration decisions are read from: the one in use now. */
  const live = (): SignInConfiguration => signIn.current?.() ?? signIn.configuration;
  /**
   * The people being signed up through a provider, by provider and email, until their first
   * account is created (a minute at most): that account is not a link. Keyed on what both hooks
   * see, not on the endpoint context, which Better Auth need not hand both hooks alike.
   */
  const signingUp = new Map<string, number>();
  const signUpKey = (providerId: string, email: string) => `${providerId}\n${email.trim().toLowerCase()}`;
  const SIGN_UP_MS = 60_000;
  function takeSignUp(key: string): boolean {
    const until = signingUp.get(key);
    signingUp.delete(key);
    for (const [other, expires] of signingUp) if (expires < Date.now()) signingUp.delete(other);
    return until !== undefined && until >= Date.now();
  }

  /**
   * Refuses this sign-in with `code`. While linking from Mon compte, Better Auth would answer the
   * refusal as JSON: the person is sent back to the flow's error page with the code instead,
   * as a sign-in is.
   */
  async function refuse(ctx: NonNullable<HookContext>, code: string, message: string): Promise<never> {
    const state = await currentOAuthState();
    if (state?.link) {
      const back = new URL(typeof state.errorURL === "string" && state.errorURL ? state.errorURL : routes.accountSignIn, baseURL);
      back.searchParams.set("error", code);
      throw ctx.redirect(back.toString());
    }
    throw new APIError("FORBIDDEN", { code, message });
  }

  async function decide(ctx: NonNullable<HookContext>, providerId: string, person: SigningInPerson): Promise<void> {
    const decision = oauthSignInDecision(live(), providerId, { isAdministrator: await signIn.isAdministrator(person) });
    if (decision === "allow") return;
    if (decision === "test") {
      const nonce = (await currentOAuthState())?.[TEST_SIGN_IN];
      if (typeof nonce === "string" && nonce && (await signIn.completeTestSignIn?.(providerId, nonce))) {
        throw ctx.redirect(new URL(`${routes.adminSignInProviders}?tested=${encodeURIComponent(providerId)}`, baseURL).toString());
      }
      return refuse(ctx, SIGN_IN_ERRORS.providerDisabled, "This provider is not enabled");
    }
    // The callback sends the person back to the page they came from, with this code.
    return refuse(ctx, SIGN_IN_ERRORS.providerNotAllowed, "This provider is for Administrators only");
  }

  const owner = async (ctx: NonNullable<HookContext>, userId: string): Promise<SigningInPerson | null> => {
    const user = await ctx.context.internalAdapter.findUserById(userId);
    return user ? { id: user.id, email: user.email, emailVerified: user.emailVerified } : null;
  };

  /** Whether `providerId`'s email is proof of owning that address (it links by email: policy.ts). */
  const vouchesForEmail = (providerId: string) => trustedProviderIds(live()).includes(providerId);

  return {
    user: {
      create: {
        before: async (user: { email: string; emailVerified: boolean }, ctx: HookContext) => {
          const providerId = providerOf(ctx);
          if (!providerId || !ctx) return undefined;
          // A provider not trusted for linking proves nothing about the address, whatever it
          // claims: the account starts unverified (no ADMIN_EMAILS standing), until a magic link.
          const emailVerified = user.emailVerified && vouchesForEmail(providerId);
          await decide(ctx, providerId, { id: "", email: user.email, emailVerified });
          signingUp.set(signUpKey(providerId, user.email), Date.now() + SIGN_UP_MS);
          return { data: { emailVerified } };
        },
      },
      update: {
        before: async (update: { emailVerified?: unknown }, ctx: HookContext) => {
          const providerId = providerOf(ctx);
          // Better Auth marks an account verified when a provider says so at sign-in: not one that proves nothing.
          // (In 1.7.7 that update sets emailVerified alone, so skipping it loses nothing else.)
          if (providerId && update.emailVerified === true && !vouchesForEmail(providerId)) return false;
          return undefined;
        },
      },
    },
    account: {
      create: {
        before: async (account: { userId: string }, ctx: HookContext) => {
          const providerId = providerOf(ctx);
          if (!providerId || !ctx) return;
          const person = await owner(ctx, account.userId);
          // An account for nobody we can find is refused, not let through unchecked.
          if (!person) throw new APIError("FORBIDDEN", { code: SIGN_IN_ERRORS.accountNotLinked, message: "Sign in by magic link, then link this provider" });
          // Their first account, as they sign up: decided by the user hook.
          if (takeSignUp(signUpKey(providerId, person.email))) return;
          await decide(ctx, providerId, person);
          // Linked by the Candidate, signed in, from Mon compte: they proved owning the account.
          if ((await currentOAuthState())?.link) return;
          if (!vouchesForEmail(providerId)) {
            throw new APIError("FORBIDDEN", { code: SIGN_IN_ERRORS.accountNotLinked, message: "Sign in by magic link, then link this provider" });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session: { userId: string }, ctx: HookContext) => {
          const providerId = providerOf(ctx);
          if (providerId && ctx) {
            const person = await owner(ctx, session.userId);
            if (person) await decide(ctx, providerId, person);
            return { data: { signInMethod: providerId } };
          }
          if (ctx?.path?.startsWith("/magic-link/verify")) return { data: { signInMethod: MAGIC_LINK } };
          return undefined;
        },
      },
    },
  };
}

/**
 * Linking from Mon compte (the callback's state carries `link`: the person is signed in and
 * asked for it) needs no verified email from the provider: being signed in proves owning the
 * account, and Better Auth still requires the provider's email to be the account's. Many
 * providers send none (Microsoft on common or organizations, some OIDC issuers), and Better Auth
 * would otherwise refuse the link of a provider not trusted for linking. Signing in is untouched.
 */
async function verifiedWhileLinking(): Promise<{ emailVerified?: true }> {
  return (await currentOAuthState())?.link ? { emailVerified: true } : {};
}

/** The endpoints that take a provider's ID token straight from the client, instead of the redirect. */
const ID_TOKEN_PATHS = ["/sign-in/social", "/link-social"];

/**
 * Refuses a sign-in or a link made with a provider's ID token posted by the client: no page or
 * client of ours does it, and it would skip the callback where the sign-in policy is applied.
 */
const refuseIdTokenSignIn = createAuthMiddleware(async (ctx) => {
  if (!ID_TOKEN_PATHS.includes(ctx.path)) return;
  const body = ctx.body as { idToken?: unknown } | undefined;
  if (body?.idToken !== undefined) {
    throw new APIError("BAD_REQUEST", { code: "ID_TOKEN_SIGN_IN_NOT_SUPPORTED", message: "Sign in through the provider's page" });
  }
});

function authOptions(config: AuthConfig) {
  const signIn = config.signIn ?? NO_SIGN_IN;
  const providers = betterAuthSignIn(signIn.configuration);
  const socialProviders = Object.fromEntries(
    Object.entries(providers.socialProviders).map(([id, options]) => [id, { ...options, mapProfileToUser: verifiedWhileLinking }]),
  ) as typeof providers.socialProviders;
  return {
    database: config.database,
    baseURL: config.baseURL,
    secret: config.secret,
    // Apple posts its callback from its own origin.
    trustedOrigins: [...(config.extensionOrigins ?? []), ...providers.trustedOrigins],
    // Sign-in failures Better Auth redirects for (a refused consent, an OAuth state it
    // cannot match, a provider for Administrators only) come back to our sign-in page,
    // translated, rather than to its own English /api/auth/error page.
    onAPIError: { errorURL: new URL(routes.signIn, config.baseURL).toString() },
    // Check request origins everywhere, tests included (Better Auth skips it under NODE_ENV=test).
    advanced: { disableOriginCheck: false },
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        // Read on every request: the providers in use, trusted for linking (policy.ts).
        trustedProviders: () => trustedProviderIds(signIn.current?.() ?? signIn.configuration),
      },
    },
    databaseHooks: signInHooks(signIn, config.baseURL),
    hooks: { before: refuseIdTokenSignIn },
    // The account of a person looking for a job is a Candidate (CONTEXT.md).
    user: {
      modelName: "candidate",
      additionalFields: {
        interfaceLanguage: {
          type: [...SUPPORTED_LOCALES],
          required: true,
          defaultValue: DEFAULT_LOCALE,
          input: true,
          validator: { input: z.enum(SUPPORTED_LOCALES) },
        },
      },
    },
    session: {
      additionalFields: {
        // How the session was signed in: a Sign-in Provider's id, or "magic-link". Set by the hooks above, never by the client.
        signInMethod: { type: "string", required: false, input: false },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_MINUTES * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }, ctx) => {
          // A returning Candidate reads the email in their Interface Language.
          const found = await ctx?.context.internalAdapter.findUserByEmail(email);
          const language = (found?.user as Record<string, unknown> | undefined)?.interfaceLanguage;
          const { t } = createI18n(isSupportedLocale(language) ? language : DEFAULT_LOCALE);
          await config.mailer.send({
            to: email,
            subject: t("signInEmail.subject"),
            text: t("signInEmail.body", { url, minutes: MAGIC_LINK_MINUTES }),
          });
        },
      }),
      // Generic OIDC providers, through the same sign-in and callback endpoints as the social ones.
      genericOAuth({ config: providers.genericOAuth.map((provider) => ({ ...provider, mapProfileToUser: verifiedWhileLinking })) }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(config: AuthConfig) {
  // Its start reads the OIDC providers' discovery documents from memory: it waits on no issuer.
  const discovered = new Map<string, Record<string, unknown>>();
  for (const provider of config.signIn?.configuration.providers ?? []) if (provider.discoveryUrl && provider.discovery) discovered.set(provider.discoveryUrl, provider.discovery);
  return withDiscoveryDocuments(discovered, () => betterAuth(authOptions(config)));
}

export type Auth = ReturnType<typeof createAuth>;

/** Creates or upgrades the Candidate account tables. Safe to run repeatedly. */
export async function migrateCandidateAccounts(config: AuthConfig): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(config));
  await runMigrations();
}
