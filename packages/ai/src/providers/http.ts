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
export async function postJson<T>(client: JsonClient, url: string, body: Record<string, unknown>): Promise<T> {
  const fetch = client.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${client.apiKey}` },
      body: JSON.stringify(body),
    });
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
