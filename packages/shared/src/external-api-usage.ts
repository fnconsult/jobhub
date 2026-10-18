/**
 * External API usage (CONTEXT.md, #218): every call Jobbbox makes to a provider that is not an
 * LLM (France Travail, contact enrichment...), as the Back Office's AI consumption report counts it.
 * A call is recorded with its provider, operation, time, duration, outcome and estimated cost,
 * never its payload, query string, Candidate or credentials.
 *
 *   const fetch = recordingFetch(globalThis.fetch, externalApis, { provider: "france_travail", costEur: () => 0 });
 */
import { scrubSecrets } from "./scrub-secrets";

/** One call to an external API, as recorded. */
export interface ExternalApiCall {
  /** e.g. "france_travail", "lusha". */
  provider: string;
  /** The HTTP method and path, e.g. "GET /partenaire/offresdemploi/v2/offres/search": no query string, secrets scrubbed. */
  operation: string;
  at: Date;
  durationMs: number;
  /** Whether it answered with a 2xx status. */
  ok: boolean;
  /** Null when no answer came (network error, timeout). */
  httpStatus: number | null;
  /** Estimated € at list price; null when not known. */
  costEur: number | null;
}

/** Where external API calls are recorded. The caller does not wait for it: it never fails nor delays a call. */
export interface ExternalApiLog {
  record(call: ExternalApiCall): void | Promise<void>;
}

export interface RecordingFetchOptions {
  provider: string;
  /** The estimated cost in € of a call that answered `status` (null: none came); null when not known. Default: not known. */
  costEur?: (status: number | null) => number | null;
  now?: () => Date;
  /** Milliseconds. Default: performance.now. */
  clock?: () => number;
  /** Where a failure to record goes. Default: console.warn. */
  warn?: (message: string, error: unknown) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any fetch-shaped function: the global one, or an adapter's narrower one.
type FetchLike = (url: any, init?: any) => Promise<Response>;

function operationOf(
  url: unknown,
  init: { method?: string } | undefined,
): string {
  const href =
    typeof url === "string"
      ? url
      : url instanceof URL
        ? url.href
        : ((url as { url?: string } | undefined)?.url ?? "");
  const method = (
    init?.method ??
    (url as { method?: string } | undefined)?.method ??
    "GET"
  ).toUpperCase();
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    path = href.split("?")[0] ?? "";
  }
  return `${method} ${scrubSecrets(decodeURIComponent(path))}`;
}

/** `fetch`, with each of its calls recorded in `log`; it answers, or fails, as `fetch` does. */
export function recordingFetch<F extends FetchLike>(
  fetch: F,
  log: ExternalApiLog,
  options: RecordingFetchOptions,
): F {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const warn =
    options.warn ??
    ((message: string, error: unknown) =>
      console.warn(
        `[external-api] ${message}`,
        error instanceof Error ? error.message : error,
      ));
  const record = (call: ExternalApiCall) => {
    try {
      void Promise.resolve(log.record(call)).catch((error: unknown) =>
        warn("External API call not recorded", error),
      );
    } catch (error) {
      warn("External API call not recorded", error);
    }
  };
  const recording = async (url: unknown, init?: { method?: string }) => {
    const at = now();
    const started = clock();
    const done = (httpStatus: number | null) =>
      record({
        provider: options.provider,
        operation: operationOf(url, init),
        at,
        durationMs: Math.round(clock() - started),
        ok: httpStatus !== null && httpStatus >= 200 && httpStatus < 300,
        httpStatus,
        costEur: options.costEur?.(httpStatus) ?? null,
      });
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      done(null);
      throw error;
    }
    done(response.status);
    return response;
  };
  return recording as F;
}
