import type { Fetch } from "./types";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A provider API played back from recorded answers: each request gets the next
 * answer in order, and is kept for the test to check. Nothing leaves the machine.
 */
export function recordedFetch(...answers: { status?: number; body: unknown }[]) {
  const requests: RecordedRequest[] = [];
  const fetchFn: Fetch = async (url, init) => {
    requests.push({ method: init.method, url, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const answer = answers.shift();
    if (!answer) throw new Error(`no recorded answer for ${init.method} ${url}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchFn, requests };
}
