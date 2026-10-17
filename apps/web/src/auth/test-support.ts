import { createThrowawayDatabase } from "../test-support/throwaway-database";
import type { SignInProvider } from "../sign-in-providers/catalog";
import { createAuth, migrateCandidateAccounts, type AuthConfig, type MailMessage, type SignInSetup } from "./index";

export const connectionString = process.env.DATABASE_URL;
export const BASE_URL = "http://localhost:3000";

/**
 * A Candidate-accounts module wired to its own throwaway Postgres database
 * (schema introspection sees every schema of a database, so test files running
 * in parallel would trip over each other's schemas), with a mailbox that
 * records every email instead of sending it.
 */
export async function startTestAuth(overrides: Partial<AuthConfig> = {}) {
  const throwaway = await createThrowawayDatabase("test_auth");
  const database = throwaway.pool;

  const mailbox: MailMessage[] = [];
  const config: AuthConfig = {
    database,
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret-0123",
    mailer: { send: async (message) => void mailbox.push(message) },
    ...overrides,
  };
  await migrateCandidateAccounts(config);
  const auth = createAuth(config);

  /** Sends a request to `instance`'s auth HTTP handler, as the browser would. */
  const requestTo =
    (instance: ReturnType<typeof createAuth>) =>
    (path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) => {
      const headers = new Headers();
      if (init.body !== undefined) headers.set("content-type", "application/json");
      if (init.cookie) headers.set("cookie", init.cookie);
      headers.set("origin", init.origin ?? BASE_URL);
      return instance.handler(
        new Request(new URL(path, BASE_URL), {
          method: init.method ?? (init.body === undefined ? "GET" : "POST"),
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      );
    };

  return {
    auth,
    /** What the instance was built with: to build another over the same tables (a rebuilt sign-in). */
    config,
    database,
    mailbox,
    /** Sends a request to the auth HTTP handler, as the browser would. */
    request: requestTo(auth),
    requestTo,
    async stop() {
      await throwaway.drop();
    },
  };
}

export type TestAuth = Awaited<ReturnType<typeof startTestAuth>>;

/** A Sign-in Provider for a test: enabled, shown to Candidates, allowed for Administrators and trusted for linking unless said otherwise. */
export function testProvider(overrides: Partial<SignInProvider> & Pick<SignInProvider, "id" | "type" | "clientId" | "clientSecret">): SignInProvider {
  return { displayName: overrides.id, enabled: true, shownToCandidates: true, allowedForAdministrators: true, trustedForLinking: true, ...overrides };
}

/** The sign-in an instance is built with in a test: `providers`, and the Administrators' emails. */
export function testSignIn(
  providers: SignInProvider[],
  options: { administrators?: string[]; completeTestSignIn?: (providerId: string, nonce: string) => Promise<boolean> } = {},
): SignInSetup {
  return {
    configuration: { providers, requireSsoForAdministrators: false, version: JSON.stringify(providers.map((provider) => provider.id)) },
    isAdministrator: async (person) => (options.administrators ?? []).includes(person.email.toLowerCase()),
    completeTestSignIn: options.completeTestSignIn ?? (async () => false),
  };
}

/** The sign-in link inside an email body. */
export function linkIn(message: MailMessage | undefined): string {
  const match = message?.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link in email: ${message?.text}`);
  return match[0];
}

/** Cookie header to send back, built from a response's Set-Cookie headers. */
export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Requests a magic link for `email` and follows it; returns the session cookie. */
export async function signInWithMagicLink(testAuth: TestAuth, email: string): Promise<string> {
  const before = testAuth.mailbox.length;
  const sent = await testAuth.request("/api/auth/sign-in/magic-link", { body: { email, callbackURL: "/" } });
  if (!sent.ok) throw new Error(`magic link request failed: ${sent.status} ${await sent.text()}`);
  const verified = await testAuth.request(linkIn(testAuth.mailbox[before]));
  return cookiesFrom(verified);
}
