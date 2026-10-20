/**
 * External API usage (CONTEXT.md, #218): every call Jobbbox makes to a provider that is not an
 * LLM (France Travail, contact enrichment...), as the Back Office's AI consumption report counts it.
 * A call is recorded with its provider, operation, time, duration, outcome and estimated cost,
 * never its payload, query string, Candidate or credentials.
 *
 *   const fetch = recordingFetch(globalThis.fetch, externalApis, { provider: "france_travail", costEur: () => 0 });
 *   const stripe = recordingClient(new Stripe(key), externalApis, { provider: "stripe" });
 */
import { scrubSecrets } from "./scrub-secrets";
import type { ExternalApiProvider } from "./tools";

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

/** How calls to one provider are recorded. */
export interface RecordingOptions {
  /** A registered Tool's (TOOLS): a call to an unregistered tool does not type-check. */
  provider: ExternalApiProvider;
  /** The estimated cost in € of a call to `operation` that answered `status` (null: none came); null when not known. Default: not known. */
  costEur?: (status: number | null, operation: string) => number | null;
  now?: () => Date;
  /** Milliseconds. Default: performance.now. */
  clock?: () => number;
  /** Where a failure to record goes. Default: console.warn. */
  warn?: (message: string, error: unknown) => void;
}

export interface RecordingFetchOptions extends RecordingOptions {
  /**
   * The operation a call is recorded as, from its method and URL; scrubbed of secrets.
   * Default: the method and the decoded path ("GET /v2/offres"), no query string.
   */
  operation?: (method: string, url: URL) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any fetch-shaped function: the global one, or an adapter's narrower one.
type FetchLike = (url: any, init?: any) => Promise<Response>;

const hrefOf = (url: unknown): string => (typeof url === "string" ? url : url instanceof URL ? url.href : ((url as { url?: string } | undefined)?.url ?? ""));
const methodOf = (url: unknown, init: { method?: string } | undefined): string => (init?.method ?? (url as { method?: string } | undefined)?.method ?? "GET").toUpperCase();

function operationOf(url: unknown, init: { method?: string } | undefined): string {
  const href = hrefOf(url);
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    path = href.split("?")[0] ?? "";
  }
  return `${methodOf(url, init)} ${scrubSecrets(safelyDecoded(path))}`;
}

/** `path` with its escapes decoded; as it is when one is malformed ("100%zz"). */
function safelyDecoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Starts timing one call; the function it returns records it, once it answered `httpStatus`
 * (null: no answer). Everything is guarded: recording never fails nor delays the call it records.
 */
function startCall(log: ExternalApiLog, options: RecordingOptions, operationOfCall: () => string): (httpStatus: number | null, ok?: boolean) => void {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const warn = options.warn ?? ((message: string, error: unknown) => console.warn(`[external-api] ${message}`, error instanceof Error ? error.message : error));
  const failed = (error: unknown) => warn("External API call not recorded", error);
  try {
    const at = now();
    const started = clock();
    return (httpStatus, ok) => {
      try {
        const operation = operationOfCall();
        const call: ExternalApiCall = {
          provider: options.provider,
          operation,
          at,
          durationMs: Math.round(clock() - started),
          ok: ok ?? (httpStatus !== null && httpStatus >= 200 && httpStatus < 300),
          httpStatus,
          costEur: options.costEur?.(httpStatus, operation) ?? null,
        };
        void Promise.resolve(log.record(call)).catch(failed);
      } catch (error) {
        failed(error);
      }
    };
  } catch (error) {
    failed(error);
    return () => {};
  }
}

/** `fetch`, with each of its calls recorded in `log`; it answers, or fails, as `fetch` does. */
export function recordingFetch<F extends FetchLike>(fetch: F, log: ExternalApiLog, options: RecordingFetchOptions): F {
  const name = options.operation;
  const recording = async (url: unknown, init?: { method?: string }) => {
    const done = startCall(log, options, () => (name ? scrubSecrets(name(methodOf(url, init), new URL(hrefOf(url)))) : operationOf(url, init)));
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

export interface RecordingClientOptions extends RecordingOptions {
  /** The HTTP status a call that returns is recorded with. Default: 200; null for a client that does not speak HTTP (SMTP). */
  answeredStatus?: number | null;
}

/** The HTTP status an SDK's error carries (Stripe's `statusCode`, a `status`); null when it has none. */
function statusOfError(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  const found = typeof statusCode === "number" ? statusCode : status;
  return typeof found === "number" && found >= 100 && found < 600 ? found : null;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";

/**
 * `client` (an SDK's: Stripe, a mailer), with each call of one of its methods, however deep
 * (`checkout.sessions.create`), recorded in `log` under that path. A call that returns, or
 * resolves, is recorded as answered `answeredStatus` (200); one that throws, or rejects, with its error's HTTP
 * status (`statusCode`, `status`), else none. Never its arguments, answer or error message.
 * It answers as `client` does: what a method returns is given back as it is (a Stripe list
 * keeps its `autoPagingToArray`). Properties that are not methods are read through.
 */
export function recordingClient<T extends object>(client: T, log: ExternalApiLog, options: RecordingClientOptions): T {
  const answered = options.answeredStatus === undefined ? 200 : options.answeredStatus;
  const wrap = <O extends object>(target: O, path: string[]): O => {
    const wrapped = new Map<PropertyKey, unknown>();
    return new Proxy(target, {
      get(object, property, receiver) {
        const value: unknown = Reflect.get(object, property, receiver);
        if (typeof property === "symbol" || property.startsWith("_") || property === "then" || property === "constructor") return value;
        if (typeof value !== "function" && (typeof value !== "object" || value === null)) return value;
        const cached = wrapped.get(property);
        if (cached && (cached as { original: unknown }).original === value) return (cached as { proxy: unknown }).proxy;
        const at = [...path, property];
        const proxy = typeof value === "function" ? recordedMethod(value as (...args: unknown[]) => unknown, object, at.join(".")) : wrap(value as object, at);
        wrapped.set(property, { original: value, proxy });
        return proxy;
      },
    });
  };
  const recordedMethod =
    (method: (...args: unknown[]) => unknown, self: object, operation: string) =>
    (...args: unknown[]): unknown => {
      const done = startCall(log, options, () => operation);
      let result: unknown;
      try {
        result = method.apply(self, args);
      } catch (error) {
        done(statusOfError(error), false);
        throw error;
      }
      if (!isThenable(result)) {
        done(answered, true);
        return result;
      }
      // Watched, not replaced: the caller gets the SDK's own promise.
      result.then(
        () => done(answered, true),
        (error: unknown) => done(statusOfError(error), false),
      );
      return result;
    };
  return wrap(client, []);
}
