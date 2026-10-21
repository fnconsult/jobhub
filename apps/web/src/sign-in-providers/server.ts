import { getBackOffice } from "@/admin/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { sharedPool } from "@/database/pool";
import { secretCipherFromEnv } from "@/provider-secrets/cipher";
import type { SignInConfiguration } from "./catalog";
import { configurationFromEnv, createSignInProviders, type SignInProviders } from "./index";
import { watchSignInConfiguration, type WatchedSignInConfiguration } from "./watch";

// On globalThis, not in a module variable: Next.js bundles server code into more than one
// chunk, each with its own copy of this module; one cache per process must serve them all,
// or a NOTIFY would refresh only one copy (see provider-secrets/server.ts).
const holder = globalThis as { __jobhubSignInProviders?: SignInProviders; __jobhubSignInConfiguration?: WatchedSignInConfiguration };

/** The Back Office's Sign-in Providers (the Connexion section). One per process. */
export function getSignInProviders(): SignInProviders {
  holder.__jobhubSignInProviders ??= createSignInProviders(sharedPool(), {
    cipher: secretCipherFromEnv(process.env),
    backOffice: getBackOffice(),
    env: process.env,
    externalApis: getExternalApiLog(),
  });
  return holder.__jobhubSignInProviders;
}

function watched(): WatchedSignInConfiguration {
  holder.__jobhubSignInConfiguration ??= watchSignInConfiguration({
    database: sharedPool(),
    load: () => getSignInProviders().load(),
    fallback: configurationFromEnv(process.env),
  });
  return holder.__jobhubSignInConfiguration;
}

/** The sign-in configuration in use in this process. Without DATABASE_URL (a build, some tests), env's Google client alone. */
export function currentSignInConfiguration(): SignInConfiguration {
  if (!process.env.DATABASE_URL) return configurationFromEnv(process.env);
  return watched().current();
}

/** Reads the configuration now: after a change made in this process, which the others hear by NOTIFY. */
export async function refreshSignInConfiguration(): Promise<SignInConfiguration> {
  if (!process.env.DATABASE_URL) return configurationFromEnv(process.env);
  return watched().refresh();
}

/** Reads the configuration a first time and starts listening for changes: the server awaits it before serving (instrumentation.ts). */
export async function startSignInProviders(): Promise<void> {
  if (process.env.DATABASE_URL) await watched().ready;
}
