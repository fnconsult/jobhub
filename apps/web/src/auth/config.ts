import { permanentSuperAdminsFromEnv } from "../admin/access";
import { sharedPool } from "../database/pool";
import { configurationFromEnv } from "../sign-in-providers/index";
import type { AuthConfig, Mailer } from "./index";
import { mailerFromEnv } from "./mailers";

export { mailerFromEnv };

type Env = Record<string, string | undefined>;

const DEV_SECRET = "development-only-secret-do-not-use-in-production";

/**
 * Reads the Candidate-accounts configuration from environment variables
 * (see .env.example). Fails fast in production when something is missing.
 * Its sign-in is env's Google client alone: the web app replaces it with the
 * database's Sign-in Providers (server.ts). Its mailer is env's, unless `mailer`
 * is given: the web app gives its own, whose MAIL_FROM may be on Paramètres alone,
 * so env's is never built (it would require MAIL_FROM in env in production, #300).
 */
export function authConfigFromEnv(env: Env, options: { mailer?: Mailer } = {}): AuthConfig {
  const production = env.NODE_ENV === "production";
  const required = (name: string, devDefault?: string): string => {
    const value = env[name] || (production ? undefined : devDefault);
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };
  const permanentSuperAdmin = permanentSuperAdminsFromEnv(env);

  return {
    database: sharedPool(env),
    baseURL: required("APP_URL", "http://localhost:3000"),
    secret: required("AUTH_SECRET", DEV_SECRET),
    mailer: options.mailer ?? mailerFromEnv(env),
    signIn: { configuration: configurationFromEnv(env), isAdministrator: async (person) => permanentSuperAdmin(person) },
    extensionOrigins: (env.EXTENSION_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
