import { sharedPool } from "../database/pool";
import type { AuthConfig } from "./index";
import { mailerFromEnv } from "./mailers";

export { mailerFromEnv };

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

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    database: sharedPool(env),
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
