import { getBackOffice } from "@/admin/server";
import { sharedPool } from "@/database/pool";
import { secretCipherFromEnv } from "./cipher";
import { createConnectionTester } from "./connection-tests";
import { createProviderSecrets, type ProviderSecrets } from "./index";
import type { SecretResolver } from "./resolver";
import { watchProviderSecrets, type WatchedProviderSecrets } from "./watch";

// On globalThis, not in a module variable: Next.js bundles server code into more than
// one chunk, each with its own copy of this module; one cache per process must serve
// them all, or a NOTIFY would refresh only one copy (see database/pool.ts).
const holder = globalThis as { __jobhubProviderSecrets?: WatchedProviderSecrets };

function watched(): WatchedProviderSecrets {
  holder.__jobhubProviderSecrets ??= watchProviderSecrets({ database: sharedPool(), env: process.env });
  return holder.__jobhubProviderSecrets;
}

/**
 * The values of the Provider Secrets in use in this process: the database's, else env's.
 * Without DATABASE_URL (a build, some tests), env alone.
 */
export function getSecretResolver(): SecretResolver {
  if (!process.env.DATABASE_URL) return envOnly;
  return watched().resolver;
}

/** Reads the Provider Secrets a first time and starts listening for changes: the server awaits it before serving (instrumentation.ts). */
export async function startProviderSecrets(): Promise<void> {
  if (process.env.DATABASE_URL) await watched().ready;
}

const envOnlySnapshot = {
  env: process.env,
  source: (name: string) => (process.env[name]?.trim() ? ("env" as const) : ("missing" as const)),
  versionOf: (names: readonly string[]) => names.join(),
};
const envOnly: SecretResolver = { current: () => envOnlySnapshot, refresh: async () => envOnlySnapshot };

let store: ProviderSecrets | undefined;

/** The Back Office's Provider Secrets (the Clés section): their state, replacing, clearing and testing them. */
export function getProviderSecrets(): ProviderSecrets {
  store ??= createProviderSecrets(sharedPool(), {
    cipher: secretCipherFromEnv(process.env),
    backOffice: getBackOffice(),
    env: process.env,
    testConnection: createConnectionTester(),
  });
  return store;
}
