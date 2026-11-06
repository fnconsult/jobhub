import { fetchOnWebApp } from "./web-app";

const WEB_APP = "https://staging.jobbbox.ai";

/** A fetch answering each address as `routes` says: a status, and the address it redirects to if any. */
function server(routes: Record<string, { status: number; location?: string }>) {
  const calls: { url: string; method: string; cookie: string | null; redirect: RequestRedirect | undefined }[] = [];
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", cookie: new Headers(init?.headers).get("cookie"), redirect: init?.redirect });
    const route = routes[url] ?? { status: 404 };
    return new Response(route.status === 200 ? "le fichier" : null, { status: route.status, headers: route.location ? { location: route.location } : {} });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const WITH_COOKIE = { headers: { cookie: "__Secure-better-auth.session_token=secret" } };

describe("a call carrying the session (#756)", () => {
  it("follows a redirect on the web app itself, the cookie with it", async () => {
    const { fetch, calls } = server({
      [`${WEB_APP}/api/applications/app_1/documents/tailored_cv.pdf`]: { status: 302, location: "/api/exports/cv-123.pdf" },
      [`${WEB_APP}/api/exports/cv-123.pdf`]: { status: 200 },
    });

    const response = await fetchOnWebApp(fetch, `${WEB_APP}/api/applications/app_1/documents/tailored_cv.pdf`, WITH_COOKIE, WEB_APP);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("le fichier");
    expect(calls.map(({ url, cookie, redirect }) => [url, cookie, redirect])).toEqual([
      [`${WEB_APP}/api/applications/app_1/documents/tailored_cv.pdf`, "__Secure-better-auth.session_token=secret", "manual"],
      [`${WEB_APP}/api/exports/cv-123.pdf`, "__Secure-better-auth.session_token=secret", "manual"],
    ]);
  });

  it("refuses a redirect off the web app: nothing, and no cookie, goes to the other host", async () => {
    for (const location of ["https://exports.example.net/cv.pdf", "//exports.example.net/cv.pdf", "https://staging.jobbbox.ai.example.net/cv.pdf", "http://staging.jobbbox.ai/cv.pdf"]) {
      const { fetch, calls } = server({ [`${WEB_APP}/api/x`]: { status: 307, location } });

      await expect(fetchOnWebApp(fetch, `${WEB_APP}/api/x`, WITH_COOKIE, WEB_APP)).rejects.toThrow(/off the web app/);
      expect(calls.map(({ url }) => url)).toEqual([`${WEB_APP}/api/x`]);
    }
  });

  it("refuses a redirect it cannot read, or one that never ends", async () => {
    const unread = server({ [`${WEB_APP}/api/x`]: { status: 302 } });
    await expect(fetchOnWebApp(unread.fetch, `${WEB_APP}/api/x`, WITH_COOKIE, WEB_APP)).rejects.toThrow(/off the web app/);

    const loop = server({ [`${WEB_APP}/api/a`]: { status: 302, location: "/api/b" }, [`${WEB_APP}/api/b`]: { status: 302, location: "/api/a" } });
    await expect(fetchOnWebApp(loop.fetch, `${WEB_APP}/api/a`, WITH_COOKIE, WEB_APP)).rejects.toThrow(/redirects/);
    expect(loop.calls.length).toBeLessThanOrEqual(6);
  });

  it("asks a 303's address as a read, without the body", async () => {
    const { fetch, calls } = server({ [`${WEB_APP}/api/x`]: { status: 303, location: "/api/y" }, [`${WEB_APP}/api/y`]: { status: 200 } });

    await fetchOnWebApp(fetch, `${WEB_APP}/api/x`, { ...WITH_COOKIE, method: "POST", body: "{}" }, WEB_APP);

    expect(calls.map(({ url, method }) => [url, method])).toEqual([
      [`${WEB_APP}/api/x`, "POST"],
      [`${WEB_APP}/api/y`, "GET"],
    ]);
  });

  it("refuses an address off the web app before anything is sent", async () => {
    const { fetch, calls } = server({});
    await expect(fetchOnWebApp(fetch, "https://exports.example.net/api/x", WITH_COOKIE, WEB_APP)).rejects.toThrow(/off the web app/);
    expect(calls).toHaveLength(0);
  });
});
