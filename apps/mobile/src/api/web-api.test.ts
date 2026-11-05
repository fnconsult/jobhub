import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_ORIGIN, MOBILE_CLIENT } from "@jobhub/shared";
import { createApi } from "./web-api";

const BASE = "https://staging.jobbbox.ai";

/** The web app as the app reaches it: every request it receives. */
function webApp() {
  const received: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    received.push(new Request(input, init));
    return Response.json({ ok: true });
  };
  return { received, fetch };
}

describe("the app's calls to the web app's API", () => {
  it("go to the web app with the session cookie, naming the app and its API Version", async () => {
    const web = webApp();
    const api = createApi({ baseURL: BASE, cookie: async () => "__Secure-better-auth.session_token=abc", fetch: web.fetch });

    await api.fetch("/api/coach/conversations?free=1");

    const [request] = web.received;
    expect(request!.url).toBe(`${BASE}/api/coach/conversations?free=1`);
    expect(request!.headers.get("cookie")).toBe("__Secure-better-auth.session_token=abc");
    expect(request!.headers.get(API_CLIENT_HEADER)).toBe(MOBILE_CLIENT);
    expect(request!.headers.get(API_VERSION_HEADER)).toBe(String(API_VERSION));
  });

  it("state the app's origin, which the web app trusts for a write as it does its own pages'", async () => {
    const web = webApp();
    const api = createApi({ baseURL: BASE, cookie: async () => "", fetch: web.fetch });

    await api.fetch("/api/coach", { method: "POST", headers: { accept: "application/x-ndjson" }, body: "{}" });

    const [request] = web.received;
    expect(request!.headers.get("origin")).toBe(APP_ORIGIN);
    expect(request!.headers.get("accept")).toBe("application/x-ndjson");
    expect(request!.headers.get("content-type")).toBe("application/json");
  });

  it("read a JSON answer against its schema, and fail on an answer that is not a success", async () => {
    const answers = [Response.json({ n: 3 }), Response.json({ error: "not_found" }, { status: 404 })];
    const api = createApi({ baseURL: BASE, cookie: async () => "", fetch: async () => answers.shift()! });
    const schema = { parse: (body: unknown) => body as { n: number } };

    await expect(api.read("/api/x", schema)).resolves.toEqual({ n: 3 });
    await expect(api.read("/api/x", schema)).rejects.toThrow("404");
  });
});
