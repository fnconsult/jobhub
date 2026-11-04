import { APP_ORIGIN, APP_SIGN_IN_PATH, SECOND_STEP_REQUIRED } from "@jobhub/shared";
import type { SessionStorage } from "./app-session";

export const TEST_BASE_URL = "https://staging.jobbbox.ai";
const COOKIE = "__Secure-better-auth.session_token";

/** Secure storage as the Keychain or Keystore keeps it, in memory: what the app leaves on the device is `values`. */
export function memoryStorage(): SessionStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  };
}

interface Session {
  email: string;
  pending: boolean;
}

/**
 * The web app's Better Auth endpoints the app calls, as they answer (apps/web/src/auth/app-session.test.ts proves the
 * real ones): the magic link asked from the app's origin alone, the session as a cookie, a session pending its second
 * step answered 401 `second_step_required` (ADR-0075), a revoked session no longer read, a link no longer valid
 * redirected to the home page.
 */
export function fakeWebApp() {
  const sessions = new Map<string, Session>();
  const links = new Map<string, string>();
  const withSecondStep = new Set<string>();
  const emailed: { email: string; callbackURL: string; link: string }[] = [];
  let next = 0;
  let offline = false;

  const json = (body: unknown, status = 200, setCookie?: string) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(setCookie ? { "set-cookie": setCookie } : {}) } });
  const sessionOf = (headers: Headers) => {
    const token = /(?:^|;\s*)__Secure-better-auth\.session_token=([^;.]+)/.exec(headers.get("cookie") ?? "")?.[1];
    return token ? { token, session: sessions.get(token) } : null;
  };
  const cleared = `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

  async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (offline) throw new TypeError("Network request failed");
    const request = new Request(input, init);
    const url = new URL(request.url);
    const fromApp = request.headers.get("expo-origin") === APP_ORIGIN && !request.headers.get("origin");
    const path = url.pathname.replace(/^\/api\/auth/, "");
    if (path === "/sign-in/magic-link" && request.method === "POST") {
      const { email, callbackURL } = (await request.json()) as { email: string; callbackURL: string };
      if (!fromApp || !callbackURL.startsWith(APP_ORIGIN)) return json({ message: "Invalid callbackURL" }, 403);
      const token = `link${++next}`;
      links.set(token, email);
      emailed.push({ email, callbackURL, link: `${TEST_BASE_URL}${APP_SIGN_IN_PATH}?token=${token}` });
      return json({ status: true });
    }
    if (path === "/magic-link/verify" && request.method === "GET") {
      const email = links.get(url.searchParams.get("token") ?? "");
      // Better Auth answers every failure with a redirect to its error address (the home page, `error=INVALID_TOKEN`),
      // which React Native's fetch follows whatever `redirect` asks: what reaches the app is that page, a 200.
      if (!email) return fetch(`${TEST_BASE_URL}/?error=INVALID_TOKEN`);
      links.delete(url.searchParams.get("token")!);
      const token = `session${++next}`;
      sessions.set(token, { email, pending: withSecondStep.has(email) });
      return json({ token, user: { email } }, 200, `${COOKIE}=${token}.signature; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`);
    }
    const found = sessionOf(request.headers);
    if (found?.session?.pending && path !== "/sign-out") return json({ error: SECOND_STEP_REQUIRED }, 401);
    if (path === "/get-session" && request.method === "GET") {
      if (!found?.session) return json(null, 200, found ? cleared : undefined);
      return json({ session: { id: found.token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: found.session.email, email: found.session.email, name: "" } });
    }
    if (path === "/sign-out" && request.method === "POST") {
      if (!fromApp) return json({ message: "Invalid origin" }, 403);
      if (found) sessions.delete(found.token);
      return json({ success: true }, 200, cleared);
    }
    if (url.pathname === "/") return new Response("<!doctype html><title>Jobbbox</title>", { status: 200, headers: { "content-type": "text/html" } });
    return json({ message: "Not found" }, 404);
  }

  return {
    fetch,
    emailed,
    /** The link the last email to `email` carries. */
    linkFor: (email: string) => emailed.findLast((sent) => sent.email === email)!.link,
    /** The account of `email` has Two-step verification: a magic link leaves its session pending. */
    withSecondStep: (email: string) => void withSecondStep.add(email),
    /** Mon compte's « Déconnecter partout », on the web. */
    revokeAll: (email: string) => {
      for (const [token, session] of sessions) if (session.email === email) sessions.delete(token);
    },
    sessionCount: () => sessions.size,
    setOffline: (value: boolean) => void (offline = value),
  };
}
