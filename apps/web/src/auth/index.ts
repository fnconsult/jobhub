/**
 * Candidate accounts: passwordless sign-up / sign-in (magic link + Google,
 * ADR-0008) and the Candidate's account settings.
 *
 * One deep module in front of Better Auth. Callers get:
 *  - `createAuth(config)` — an instance whose `handler(Request)` serves every
 *    `/api/auth/*` endpoint and whose `api` reads sessions server-side;
 *  - `migrateCandidateAccounts(config)` — creates / upgrades the tables.
 * Everything else (tables, cookies, tokens, OAuth) stays behind this seam.
 */
import { createI18n, DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins/magic-link";
import type { Pool } from "pg";
import * as z from "zod";

/** An email ready to send. Plain text keeps it readable in every mail client. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Delivers emails. Adapters: SMTP in production, console in development, a mailbox in tests. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface AuthConfig {
  /** Postgres pool. Its search_path decides which schema holds the accounts. */
  database: Pool;
  /** Public origin of the web app, e.g. https://app.jobbbox.fr */
  baseURL: string;
  /** At least 32 random characters; signs session cookies. */
  secret: string;
  mailer: Mailer;
  /** Google OAuth client. Without it, "Continue with Google" is unavailable. */
  google?: { clientId: string; clientSecret: string } | undefined;
  /**
   * Origins of our browser extension builds (chrome-extension://<id>). They
   * share the web app's session, so they may act for the signed-in Candidate.
   */
  extensionOrigins?: string[] | undefined;
}

/** How long a magic link stays valid. */
export const MAGIC_LINK_MINUTES = 15;

function authOptions(config: AuthConfig) {
  return {
    database: config.database,
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.extensionOrigins ?? [],
    // Check request origins everywhere, tests included (Better Auth skips it under NODE_ENV=test).
    advanced: { disableOriginCheck: false },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
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
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(config: AuthConfig) {
  return betterAuth(authOptions(config));
}

export type Auth = ReturnType<typeof createAuth>;

/** Creates or upgrades the Candidate account tables. Safe to run repeatedly. */
export async function migrateCandidateAccounts(config: AuthConfig): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(config));
  await runMigrations();
}
