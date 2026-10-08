import { describe, expect, it } from "vitest";
import { unsubscribeResponse } from "./http";

const BASE = "https://app.jobbbox.fr";
const TOKEN = "a".repeat(43);

function digests() {
  const used: string[] = [];
  return {
    used,
    jobDigests: { unsubscribeByToken: async (token: string) => (used.push(token), token === TOKEN) },
  };
}

function post(body: string, token = TOKEN) {
  return new Request(`${BASE}/api/job-digests/unsubscribe?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("the Job Digest unsubscribe endpoint", () => {
  it("unsubscribes on a one-click POST from the mail client, answering without a redirect (RFC 8058)", async () => {
    const { used, jobDigests } = digests();

    const response = await unsubscribeResponse(post("List-Unsubscribe=One-Click"), jobDigests);

    expect(response.status).toBe(200);
    expect(used).toEqual([TOKEN]);
  });

  it("sends a Candidate who confirmed on the unsubscribe page back to it, saying it is done", async () => {
    const { used, jobDigests } = digests();

    const response = await unsubscribeResponse(post(""), jobDigests);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${BASE}/desabonnement?done=1`);
    expect(used).toEqual([TOKEN]);
  });

  it("keeps the language the page was shown in", async () => {
    const { jobDigests } = digests();
    const request = new Request(`${BASE}/api/job-digests/unsubscribe?token=${TOKEN}&lang=en`, { method: "POST", body: new URLSearchParams() });

    expect((await unsubscribeResponse(request, jobDigests)).headers.get("location")).toBe(`${BASE}/desabonnement?done=1&lang=en`);
  });

  it("says so when the token names no opt-in", async () => {
    const { jobDigests } = digests();

    expect((await unsubscribeResponse(post("List-Unsubscribe=One-Click", "b".repeat(43)), jobDigests)).status).toBe(404);
    const fromPage = await unsubscribeResponse(post("", "forged"), jobDigests);
    expect(fromPage.headers.get("location")).toBe(`${BASE}/desabonnement?done=0`);
  });
});
