/**
 * Better Auth 1.7 reads an OIDC provider's discovery document itself, when an instance
 * starts, with no time limit; and only through that document does it verify ID tokens and
 * bind their nonce. So an instance is started with the documents the Sign-in Providers
 * already read (with a time limit, sign-in-providers/index.ts) answered from memory: starting
 * it asks no issuer anything, and an issuer that hangs cannot keep it from starting.
 *
 * The answers apply only within `withDiscoveryDocuments` (AsyncLocalStorage, which the
 * instance's start inherits): every other request this process makes goes to the network.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const documents = new AsyncLocalStorage<ReadonlyMap<string, Record<string, unknown>>>();
const SERVES = Symbol("serves discovery documents");

const urlOf = (input: Request | string | URL): string => (input instanceof Request ? input.url : String(input));

/** Wraps the fetch in use (again, if something replaced it since) so it answers from `documents` within them. */
function install(): void {
  const current = globalThis.fetch as typeof fetch & { [SERVES]?: true };
  if (current[SERVES]) return;
  const serving = Object.assign(
    (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
      const document = documents.getStore()?.get(urlOf(input));
      return document ? Promise.resolve(Response.json(document)) : current(input, init);
    },
    { [SERVES]: true as const },
  );
  globalThis.fetch = serving as typeof fetch;
}

/** Runs `start` (building a Better Auth instance) with each of `byUrl`'s discovery documents answered from memory. */
export function withDiscoveryDocuments<T>(byUrl: ReadonlyMap<string, Record<string, unknown>>, start: () => T): T {
  if (byUrl.size === 0) return start();
  install();
  return documents.run(byUrl, start);
}
