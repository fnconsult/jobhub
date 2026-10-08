import { Pool } from "pg";
import type { AuthConfig, Mailer } from "./index";
import { consoleMailer, smtpMailer } from "./mailers";

type Env = Record<string, string | undefined>;

const DEV_SECRET = "development-only-secret-do-not-use-in-production";

/**
 * The outgoing mailer from environment variables (see .env.example): SMTP, or
 * the server log. Fails fast in production when SMTP is not configured.
 */
export function mailerFromEnv(env: Env): Mailer {
  const production = env.NODE_ENV === "production";
  // MAIL_TRANSPORT=console prints emails, sign-in links included, to the server log:
  // the default in development, an explicit opt-in for local production builds (e2e).
  if (env.MAIL_TRANSPORT === "console" || (!production && !env.SMTP_URL)) return consoleMailer();
  if (!env.SMTP_URL) throw new Error("Missing environment variable SMTP_URL");
  const from = env.MAIL_FROM || (production ? undefined : "Jobbbox <bonjour@localhost>");
  if (!from) throw new Error("Missing environment variable MAIL_FROM");
  return smtpMailer(env.SMTP_URL, from);
}

/**
 * Reads the Candidate-accounts configuration from environment variables
 * (see .env.example). Fails fast in production when something is missing.
 */
export function authConfigFromEnv(env: Env): AuthConfig {
  const production = env.NODE_ENV === "production";
  const required = (name: string, devDefault?: string): string => {
    const value = env[name] || (production ? undefined : devDefault);
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    database: new Pool({ connectionString: required("DATABASE_URL") }),
    baseURL: required("APP_URL", "http://localhost:3000"),
    secret: required("AUTH_SECRET", DEV_SECRET),
    mailer: mailerFromEnv(env),
    google,
    extensionOrigins: (env.EXTENSION_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
