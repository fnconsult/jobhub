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
 */
export function postJson<T>(client: JsonClient, url: string, body: Record<string, unknown>): Promise<T> {
  return requestJson<T>(client, url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${client.apiKey}` },
    body: JSON.stringify(body),
  });
}

/** GETs a JSON answer, with the provider's own auth headers. Fails like `postJson`. */
export function getJson<T>(client: Omit<JsonClient, "apiKey">, url: URL, headers: Record<string, string>): Promise<T> {
  return requestJson<T>(client, url.href, { method: "GET", headers: { accept: "application/json", ...headers } });
}

async function requestJson<T>(client: Pick<JsonClient, "provider" | "fetch">, url: string, init: RequestInit): Promise<T> {
  const fetch = client.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new AiProviderError(client.provider, "network error", undefined, { cause: error });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new AiProviderError(client.provider, `HTTP ${response.status} ${detail}`.trim(), response.status);
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AiProviderError(client.provider, "response is not valid JSON", response.status, { cause: error });
  }
}
