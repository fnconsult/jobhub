/**
 * The one wrapper around the process's fetch that the auth module needs (Better Auth 1.7 has
 * no fetch hook): discovery-documents.ts answers an OIDC issuer's discovery document from
 * memory while an instance starts, sign-in-calls.ts records a callback's calls (#234). Each
 * adds a layer here; the fetch in use is wrapped once, for all of them.
 *
 * Two modules each wrapping the fetch in use, each checking only that its own wrapper was on
 * top, wrapped each other again on every rebuild of the instance: the chain grew without
 * limit and a sign-in's calls were recorded more than once.
 *
 * The fetch is wrapped again only if something replaced it since (a test's stub). Should
 * something wrap this wrapper, a call it passes back in goes straight through: the layers
 * apply once per call, never twice.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** A layer's answer to a call: its own, or `next`'s (the layers within it, then the network). */
export type FetchLayer = (input: Request | string | URL, init: RequestInit | undefined, next: typeof fetch) => Promise<Response>;

/** Outermost first: in the order they were first added. */
const layers = new Set<FetchLayer>();
const LAYERED = Symbol("auth fetch layers");
/** Set while the fetch the layers wrap is called: a call coming back through a wrapper is not layered again. */
const passingThrough = new AsyncLocalStorage<true>();

/** Adds `layer` to every call this process's fetch makes, wrapping the fetch in use unless it already is. */
export function addFetchLayer(layer: FetchLayer): void {
  layers.add(layer);
  const current = globalThis.fetch as typeof fetch & { [LAYERED]?: true };
  if (current[LAYERED]) return;
  const network = ((input: Request | string | URL, init?: RequestInit) => passingThrough.run(true, () => current(input, init))) as typeof fetch;
  const layered = Object.assign(
    (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
      if (passingThrough.getStore()) return current(input, init);
      const answer = [...layers].reduceRight<typeof fetch>((next, layer) => ((i: Request | string | URL, n?: RequestInit) => layer(i, n, next)) as typeof fetch, network);
      return answer(input, init);
    },
    { [LAYERED]: true as const },
  );
  globalThis.fetch = layered as typeof fetch;
}
