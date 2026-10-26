import { getBackOffice } from "@/admin/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { sharedPool } from "@/database/pool";
import { secretCipherFromEnv } from "./cipher";
import { createConnectionTester } from "./connection-tests";
import { createProviderSecrets, type ProviderSecrets } from "./index";
import { snapshotOf, type SecretResolver } from "./resolver";
import { watchProviderSecrets, type WatchedProviderSecrets } from "./watch";

// On globalThis, not in a module variable: Next.js bundles server code into more than
// one chunk, each with its own copy of this module; one cache per process must serve
// them all, or a NOTIFY would refresh only one copy (see database/pool.ts).
const holder = globalThis as { __jobhubProviderSecrets?: WatchedProviderSecrets; __jobhubProviderSecretsStore?: ProviderSecrets };

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

/** Env alone: the values in use with nothing read from a database. */
const envOnly: SecretResolver = {
  current: () => snapshotOf(process.env, {}),
  refresh: async () => snapshotOf(process.env, {}),
};

/**
 * Whether France Travail refused Offres d'emploi at the latest test of the keys in use (#400): its
 * Job discovery source then awaits access, and runs go on without it. Never without a database.
 */
export async function franceTravailAwaitingAccess(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const access = await getProviderSecrets().apiAccess("france-travail");
  return access.some(({ api, state }) => api === "offres_emploi" && state === "refused");
}

/** The Back Office's Provider Secrets (the Clés section): their state, replacing, clearing and testing them. One per process, like the resolver. */
export function getProviderSecrets(): ProviderSecrets {
  holder.__jobhubProviderSecretsStore ??= createProviderSecrets(sharedPool(), {
    cipher: secretCipherFromEnv(process.env),
    backOffice: getBackOffice(),
    env: process.env,
    // Each test's call is recorded as a connection_test of its Tool (Outils).
    testConnection: createConnectionTester({ externalApis: getExternalApiLog() }),
  });
  return holder.__jobhubProviderSecretsStore;
}
