import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { permanentSuperAdminsFromEnv } from "@/admin/access";
import { MAIL_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";
import type { SignInConfiguration } from "@/sign-in-providers/catalog";
import { APPLE_ORIGIN } from "@/sign-in-providers/policy";
import { currentSignInConfiguration, getSignInProviders } from "@/sign-in-providers/server";
import { authConfigFromEnv, mailerFromEnv } from "./config";
import { createAuth, type Auth, type Mailer, type SignInSetup } from "./index";

let built: { version: string; auth: Auth } | undefined;
let mailer: Mailer | undefined;

/** The app's mailer: SMTP_URL from the Provider Secrets (Brevo), else env, rebuilt when it is replaced in the Back Office. */
export function getMailer(): Mailer {
  mailer ??= liveObject(getSecretResolver(), MAIL_SECRET_NAMES, mailerFromEnv);
  return mailer;
}

/** The sign-in an instance is built with: `configuration`, the Administrators read afresh, and test sign-ins marked as passed. */
function signInSetup(configuration: SignInConfiguration): SignInSetup {
  const permanentSuperAdmin = permanentSuperAdminsFromEnv(process.env);
  return {
    configuration,
    async isAdministrator(person) {
      if (permanentSuperAdmin(person)) return true;
      // A person signing up holds no Back Office Role yet.
      if (!person.id) return false;
      // Imported here: the Back Office's module reads the session through this one.
      const { getAdministrators } = await import("@/admin/server");
      return (await getAdministrators().access(person)).isAdministrator;
    },
    onTestPassed: (providerId) => getSignInProviders().markTested(providerId),
  };
}

/**
 * The app's Candidate-accounts module, configured from the environment (and the Provider
 * Secrets) and from the Sign-in Providers in use. Built again whenever those change (a
 * provider added, enabled, edited in the Back Office): over the same tables and secret,
 * so nobody is signed out.
 */
export function getAuth(): Auth {
  const configuration = currentSignInConfiguration();
  if (built?.version !== configuration.version) {
    built = {
      version: configuration.version,
      auth: createAuth({ ...authConfigFromEnv(getSecretResolver().current().env), mailer: getMailer(), signIn: signInSetup(configuration) }),
    };
  }
  return built.auth;
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
