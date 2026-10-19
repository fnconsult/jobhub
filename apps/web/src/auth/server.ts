import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { permanentSuperAdminsFromEnv } from "@/admin/access";
import { MAIL_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";
import type { SignInConfiguration } from "@/sign-in-providers/catalog";
import { APPLE_ORIGIN } from "@/sign-in-providers/policy";
import { currentSignInConfiguration, getSignInProviders, refreshSignInConfiguration } from "@/sign-in-providers/server";
import { authConfigFromEnv, mailerFromEnv } from "./config";
import { createAuth, type Auth, type Mailer, type SignInSetup } from "./index";
import { swapWhenReady } from "./instances";

let mailer: Mailer | undefined;
/** How long a change made in this process waits for the rebuilt sign-in to have started. */
const REBUILD_WAIT_MS = 5_000;

// On globalThis: Next.js bundles server code into more than one chunk (see sign-in-providers/server.ts).
const holder = globalThis as { __jobhubAuthInstances?: ReturnType<typeof swapWhenReady<Auth>> };
const instances = () => (holder.__jobhubAuthInstances ??= swapWhenReady<Auth>((auth) => auth.$context));

/** The app's mailer: BREVO_API_KEY or SMTP_URL from the Provider Secrets (Brevo), else env, rebuilt when it is replaced in the Back Office. */
export function getMailer(): Mailer {
  mailer ??= liveObject(getSecretResolver(), MAIL_SECRET_NAMES, mailerFromEnv);
  return mailer;
}

/** The sign-in an instance is built with: `configuration`, the Administrators read afresh, and the Back Office's test sign-ins checked. */
function signInSetup(configuration: SignInConfiguration): SignInSetup {
  const permanentSuperAdmin = permanentSuperAdminsFromEnv(process.env);
  return {
    configuration,
    // Decisions follow the configuration in use now, even on an instance not rebuilt yet.
    current: currentSignInConfiguration,
    async isAdministrator(person) {
      if (permanentSuperAdmin(person)) return true;
      // A person signing up holds no Back Office Role yet.
      if (!person.id) return false;
      // Imported here: the Back Office's module reads the session through this one.
      const { getAdministrators } = await import("@/admin/server");
      return (await getAdministrators().access(person)).isAdministrator;
    },
    async completeTestSignIn(providerId, nonce) {
      const passed = await getSignInProviders().completeTestSignIn(providerId, nonce);
      if (passed) void refreshSignInConfiguration();
      return passed;
    },
  };
}

/**
 * The app's Candidate-accounts module, configured from the environment (and the Provider
 * Secrets) and from the Sign-in Providers in use. Built again whenever those change (a
 * provider added, enabled, edited in the Back Office): over the same tables and secret,
 * so nobody is signed out. A rebuilt one is used once it has started (instances.ts).
 */
export function getAuth(): Auth {
  const configuration = currentSignInConfiguration();
  return instances().get(configuration.version, () =>
    createAuth({ ...authConfigFromEnv(getSecretResolver().current().env), mailer: getMailer(), signIn: signInSetup(configuration) }),
  );
}

/**
 * After a change made in this process (the Connexion section): reads the configuration again
 * and waits, a few seconds at most, for the sign-in rebuilt from it to be the one in use.
 */
export async function applyLatestSignIn(): Promise<void> {
  const { version } = await refreshSignInConfiguration();
  getAuth();
  await instances().settled(version, REBUILD_WAIT_MS);
}

/** The session signed in on this request and its Candidate, or null. Never touches the database for anonymous visitors. */
export async function getCurrentSession() {
  const requestHeaders = await headers();
  if (!getSessionCookie(requestHeaders)) return null;
  return getAuth().api.getSession({ headers: requestHeaders });
}

/** The ids of the Sign-in Providers linked to the signed-in Candidate's account (none when signed out). */
export async function linkedSignInProviders(): Promise<string[]> {
  const requestHeaders = await headers();
  if (!getSessionCookie(requestHeaders)) return [];
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  return accounts.map((account) => account.providerId);
}

/** The Candidate signed in on this request, or null. Never touches the database for anonymous visitors. */
export async function getCurrentCandidate() {
  return (await getCurrentSession())?.user ?? null;
}

/**
 * Whether a state-changing request comes from the web app itself (or our
 * extension), not from another site riding on the Candidate's session cookie.
 */
export function isFromTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const { baseURL, trustedOrigins } = getAuth().options;
  // Apple's origin is trusted for its sign-in callback alone, never to act for a Candidate.
  const trusted = [new URL(String(baseURL)).origin, ...(Array.isArray(trustedOrigins) ? trustedOrigins : [])].filter((candidate) => candidate !== APPLE_ORIGIN);
  return trusted.includes(origin);
}
