import { Pool } from "pg";
import type { AuthConfig } from "./index";
import { mailerFromEnv } from "./mailers";

type Env = Record<string, string | undefined>;

const DEV_SECRET = "development-only-secret-do-not-use-in-production";

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

  // MAIL_TRANSPORT=console prints emails, sign-in links included, to the server log:
  // the default in development, an explicit opt-in for local production builds (e2e).
  const mailer = mailerFromEnv(env);
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    database: new Pool({ connectionString: required("DATABASE_URL") }),
    baseURL: required("APP_URL", "http://localhost:3000"),
    secret: required("AUTH_SECRET", DEV_SECRET),
    mailer,
    google,
    extensionOrigins: (env.EXTENSION_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
