import { AiProviderError } from "../errors";
import type { ProviderId } from "../types";

export interface JsonClient {
  provider: ProviderId;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * POSTs a JSON body with a bearer key and returns the parsed JSON answer.
 * A network failure, a non-2xx status or a body that is not JSON is an AiProviderError.
 * Once `signal` aborts, the request is stopped and this rejects with the signal's reason (#325).
 */
export function postJson<T>(client: JsonClient, url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(client, [client.apiKey], url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${client.apiKey}` },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/** GETs a JSON answer, with the provider's own auth headers. Fails, and stops, like `postJson`. */
export function getJson<T>(client: Omit<JsonClient, "apiKey">, url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(client, Object.values(headers), url.href, { method: "GET", headers: { accept: "application/json", ...headers }, ...(signal ? { signal } : {}) });
}

/** `secrets`: the credentials sent, kept out of any error (a provider may echo them back). */
async function requestJson<T>(client: Pick<JsonClient, "provider" | "fetch">, secrets: readonly string[], url: string, init: RequestInit): Promise<T> {
  const fetch = client.fetch ?? globalThis.fetch;
  /** The abort error once the call is stopped, whatever failed with it; else `error`. */
  const stoppedOr = (error: AiProviderError) => (init.signal?.aborted ? init.signal.reason : error);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw stoppedOr(new AiProviderError(client.provider, "network error", undefined, { cause: error }));
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw stoppedOr(new AiProviderError(client.provider, `HTTP ${response.status} ${detail}`.trim(), response.status, { secrets }));
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw stoppedOr(new AiProviderError(client.provider, "response is not valid JSON", response.status, { cause: error }));
  }
}
