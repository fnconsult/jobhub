import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAuth, migrateCandidateAccounts, type AuthConfig, type MailMessage } from "./index";

export const connectionString = process.env.DATABASE_URL;
export const BASE_URL = "http://localhost:3000";

/**
 * A Candidate-accounts module wired to its own throwaway Postgres database
 * (schema introspection sees every schema of a database, so test files running
 * in parallel would trip over each other's schemas), with a mailbox that
 * records every email instead of sending it.
 */
export async function startTestAuth(overrides: Partial<AuthConfig> = {}) {
  const name = `test_auth_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(connectionString!);
  url.pathname = `/${name}`;
  const database = new Pool({ connectionString: url.toString() });

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

  return {
    auth,
    mailbox,
    /** Sends a request to the auth HTTP handler, as the browser would. */
    request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
      const headers = new Headers();
      if (init.body !== undefined) headers.set("content-type", "application/json");
      if (init.cookie) headers.set("cookie", init.cookie);
      headers.set("origin", init.origin ?? BASE_URL);
      return auth.handler(
        new Request(new URL(path, BASE_URL), {
          method: init.method ?? (init.body === undefined ? "GET" : "POST"),
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      );
    },
    async stop() {
      await database.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export type TestAuth = Awaited<ReturnType<typeof startTestAuth>>;

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
