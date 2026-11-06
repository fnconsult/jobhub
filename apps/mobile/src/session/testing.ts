import CookieManager from "@preeternal/react-native-cookie-manager";
import { API_CLIENT_HEADER, APP_ORIGIN, APP_SIGN_IN_PATH, SECOND_STEP_ENDPOINT, SECOND_STEP_PASSKEY_ENDPOINT, SECOND_STEP_REQUIRED, type SecondStepRead } from "@jobhub/shared";
import type { SignInProviderButton } from "@jobhub/shared/sign-in-providers";
import {
  agendaResponseSchema,
  applicationResponseSchema,
  offerBoxResponseSchema,
  profileResponseSchema,
  tailoredDocumentsResponseSchema,
  type AgendaResponse,
  type ApplicationResponse,
  type LegalStepsResponse,
  type OfferBoxResponse,
  type ProfileResponse,
  type ProfilesResponse,
  type ShownLegalTextRead,
  type TailoredDocumentsResponse,
} from "@jobhub/shared/reads";
import { fakeWebView, type WebViewCookie } from "../testing-device";
import type { AuthBrowser, DevicePasskeys, SessionStorage, WebViewCookies } from "./app-session";

const NO_AGENDA: AgendaResponse = { toSchedule: [], days: [] };
const NO_OFFER_BOX: OfferBoxResponse = { today: "2026-11-05", toHandle: 0, entries: [] };

export const TEST_BASE_URL = "https://staging.jobbbox.ai";
/** The reads of the account's own the fake answers with its writes (#689), not with the Candidate's data (#695). */
const ACCOUNT_READS = new Set(["/api/coach-space", "/api/account/legal-steps", "/api/account/export"]);
const COOKIE = "__Secure-better-auth.session_token";
/** The name the Data export's route gives its file (`attachment; filename=…`). */
export const EXPORT_FILE_NAME = "jobbbox-donnees-2026-11-06.json";

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

/**
 * The WebViews' cookie store, as the app's instance empties it (src/session/instance.ts), on the fake device's
 * (src/testing-device.ts): `cookies()` is what a WebView of the app would send, with its address.
 */
export function memoryWebViewCookies(): WebViewCookies & { cookies: () => WebViewCookie[] } {
  return {
    cookies: () => fakeWebView.cookies,
    clear: async () => void (await CookieManager.clearAllStores()),
  };
}

interface Session {
  email: string;
  pending: boolean;
  /** The passkey challenge last asked in this session: it serves one answer. */
  challenge?: string;
}

/** A Legal Text Version as `GET /api/account/legal-steps` shows it, in French. */
export function shownLegalText(text: "cgu" | "confidentialite", version: string): ShownLegalTextRead {
  return {
    version,
    url: `/legal/${text}/${version}`,
    title: text === "cgu" ? "Conditions générales d'utilisation" : "Politique de confidentialité",
    translation: false,
    inBrief: [text === "cgu" ? "Jobbbox vous aide à chercher un emploi." : "Vos données restent dans l'Union européenne."],
    sections: [{ title: "1. Objet", body: "Jobbbox **aide** les Candidats.\n\n- un coach IA\n- des coachs humains" }],
  };
}

/** What a Candidate's request to the web app's API recorded: the route, its body, and the client it named. */
interface Recorded {
  email: string;
  method: string;
  path: string;
  body: unknown;
  client: string | null;
}

/** An account's Two-step verification: its factors, or none yet when it must set one up (`setup`). */
interface Factors {
  app: boolean;
  passkey: boolean;
  setup: boolean;
  backupCodes: Set<string>;
  failed: number;
  lockedUntil: Date | null;
}

/** Wrong codes in a row before every code is refused for a while, and for how long, as on the web (MAX_FAILED_ATTEMPTS, LOCK_MINUTES). */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const APP_CODE = "246810";

/** What the person does in the system's browser, at the provider (`atProvider`). */
export type AtProvider =
  /** Signs in as `signIn`. */
  | { signIn: string }
  /** Comes back with this `error`: refused at the provider (access_denied), or by the web app (provider_disabled…). */
  | { error: string }
  /** Closes the browser (iOS « Annuler », Android's back button). */
  | "closed"
  /** Comes back with neither. */
  | "nothing";

/**
 * What a Candidate has on the web app, as its reads answer it (#684, `@jobhub/shared/reads`): their Profiles, an
 * archived one included, and their Applications, each with its Tailored Documents.
 */
export interface CandidateData {
  profiles?: ProfileResponse[];
  /** Their Agenda (#693); an empty one when not given. */
  agenda?: AgendaResponse;
  applications?: { application: ApplicationResponse; documents: TailoredDocumentsResponse }[];
  /** Their Offer box (ADR-0090, #815); an empty one when not given. */
  offerBox?: OfferBoxResponse;
}

/**
 * The web app's Better Auth endpoints the app calls, as they answer (apps/web/src/auth/app-session.test.ts and
 * sign-in-code.test.ts prove the real ones): the magic link asked from the app's origin alone, the session as a cookie,
 * a session pending its second step answered 401 `second_step_required` (ADR-0075), a revoked session no longer read, a
 * link no longer valid redirected to the home page; the email's code (#686), 5 tries, once, spending its link. The
 * second step (#688) as its endpoints answer it (two-step-verification/index.ts and its routes prove the real ones):
 * what the session has to do, a code, a passkey of the account's own, the lock. The API routes of #689: whether the
 * person is a Human Coach, the legal steps after sign-in and their answers (a write refused without the app's origin),
 * each recorded in `recorded`; and a Job Search started for one of the Candidate's Profiles (#699). The Sign-in Providers shown to Candidates, and their OAuth flow (#687,
 * apps/web/src/auth/app-oauth.test.ts proves the real one): asked without a redirect, then opened in the system's
 * authentication browser (`browser`) through the Expo proxy, back in the app's scheme with the session cookie or the
 * refusal's code. Its session never waits for a second step.
 */
export function fakeWebApp() {
  const sessions = new Map<string, Session>();
  const links = new Map<string, string>();
  const twoStep = new Map<string, Factors>();
  /** The code each address's last email carries, and the wrong tries made with it. */
  const codes = new Map<string, { code: string; tries: number }>();
  const emailed: { email: string; callbackURL: string; link: string; code: string }[] = [];
  /** Each Candidate's data, by their email, parsed with the reads' own schemas so a test cannot give the app what the web app would never answer. */
  const data = new Map<string, Required<CandidateData>>();
  /** What the app read of the Candidate's reads (`/api/*` but `/api/auth/*`), its path and query, and with whose session. */
  const reads: { path: string; as: string | null }[] = [];
  /** A read answered `status` instead, `times` in a row, as a server failing would. */
  const failing = new Map<string, { status: number; times: number }>();
  let next = 0;
  let offline = false;
  const humanCoaches = new Set<string>();
  const steps = new Map<string, LegalStepsResponse>();
  const recorded: Recorded[] = [];
  const stepsOf = (email: string): LegalStepsResponse => steps.get(email) ?? { acceptance: null, privacyChange: null, euAiConsentGiven: true };
  let providers: SignInProviderButton[] = [];
  let atProvider: AtProvider = "closed";
  /** The OAuth flows started, by their state. */
  const flows = new Map<string, { callbackURL: string; errorCallbackURL: string }>();
  const signInsAsked: { provider: string; callbackURL: string; errorCallbackURL: string; idToken: boolean }[] = [];
  const browserOpened: { url: string; returnUrl: string }[] = [];
  /** Where the Data export's route redirects, when it does (`exportMovedTo`). */
  let exportMovedTo: string | null = null;

  const json = (body: unknown, status = 200, setCookie?: string) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(setCookie ? { "set-cookie": setCookie } : {}) } });
  const sessionOf = (headers: Headers) => {
    const token = /(?:^|;\s*)__Secure-better-auth\.session_token=([^;.]+)/.exec(headers.get("cookie") ?? "")?.[1];
    return token ? { token, session: sessions.get(token) } : null;
  };
  const cleared = `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
  /** A new session for `email`, its cookie: pending its second step when the account has it, unless `bothSteps`. */
  const newSession = (email: string, bothSteps = false) => {
    const token = `session${++next}`;
    sessions.set(token, { email, pending: !bothSteps && twoStep.has(email) });
    return { token, setCookie: `${COOKIE}=${token}.signature; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax` };
  };
  /** Signed in by magic link or its code: the session in the answer, as its cookie. */
  const signedIn = (email: string) => {
    const { token, setCookie } = newSession(email);
    return json({ token, user: { email } }, 200, setCookie);
  };

  /** The system's authentication browser, the person at the provider doing what `atProvider` says. */
  const browser: AuthBrowser = async (url, returnUrl) => {
    browserOpened.push({ url, returnUrl });
    const proxy = new URL(url);
    if (`${proxy.origin}${proxy.pathname}` !== `${TEST_BASE_URL}/api/auth/expo-authorization-proxy`) throw new Error(`the browser opened ${url}`);
    const flow = flows.get(new URL(proxy.searchParams.get("authorizationURL")!).searchParams.get("state") ?? "");
    if (!flow) return { type: "success", url: `${returnUrl}?error=state_mismatch` };
    if (atProvider === "closed") return { type: "cancel" };
    if (atProvider === "nothing") return { type: "success", url: flow.callbackURL };
    if ("error" in atProvider) return { type: "success", url: `${flow.errorCallbackURL}?error=${atProvider.error}` };
    const { setCookie } = newSession(atProvider.signIn, true);
    return { type: "success", url: `${flow.callbackURL}?cookie=${encodeURIComponent(setCookie)}` };
  };

  /**
   * The Candidate's reads, as the routes under apps/web/src/app/api answer them: 401 without a session, 404 for what is
   * not the Candidate's; `GET /api/profiles` leaves the Archived Profiles out, `GET /api/profiles/:id` does not.
   */
  function read(path: string, email: string | null): Response {
    if (!email) return json({ error: "unauthorized" }, 401);
    const mine = data.get(email) ?? { profiles: [], agenda: NO_AGENDA, applications: [], offerBox: NO_OFFER_BOX };
    const notFound = json({ error: "not_found" }, 404);
    if (path === "/api/agenda") return json(mine.agenda);
    if (path === "/api/offer-box") return json(mine.offerBox);
    if (path === "/api/profiles") return json(mine.profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name })) satisfies ProfilesResponse);
    const profile = /^\/api\/profiles\/([^/]+)$/.exec(path);
    if (profile) {
      const found = mine.profiles.find((candidate) => candidate.id === decodeURIComponent(profile[1]!));
      return found ? json(found) : notFound;
    }
    const application = /^\/api\/applications\/([^/]+)(\/documents)?$/.exec(path);
    if (application) {
      const found = mine.applications.find((candidate) => candidate.application.id === decodeURIComponent(application[1]!));
      if (!found) return notFound;
      return json(application[2] ? found.documents : found.application);
    }
    return notFound;
  }

  async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (offline) throw new TypeError("Network request failed");
    const request = new Request(input, init);
    const url = new URL(request.url);
    const fromApp = request.headers.get("expo-origin") === APP_ORIGIN && !request.headers.get("origin");
    const path = url.pathname.replace(/^\/api\/auth/, "");
    if (url.pathname === "/api/sign-in-providers" && request.method === "GET") return json({ providers });
    if (path === "/sign-in/social" && request.method === "POST") {
      const body = (await request.json()) as { provider: string; callbackURL: string; errorCallbackURL: string; disableRedirect?: boolean; idToken?: unknown };
      signInsAsked.push({ provider: body.provider, callbackURL: body.callbackURL, errorCallbackURL: body.errorCallbackURL, idToken: body.idToken !== undefined });
      if (body.idToken !== undefined) return json({ code: "ID_TOKEN_SIGN_IN_NOT_SUPPORTED" }, 400);
      if (!fromApp || !body.callbackURL.startsWith(APP_ORIGIN) || !body.errorCallbackURL.startsWith(APP_ORIGIN)) return json({ message: "Invalid callbackURL" }, 403);
      const state = `state${++next}`;
      flows.set(state, { callbackURL: body.callbackURL, errorCallbackURL: body.errorCallbackURL });
      return json({ url: `https://${body.provider}.example/authorize?state=${state}`, redirect: !body.disableRedirect });
    }
    if (path === "/sign-in/magic-link" && request.method === "POST") {
      const { email, callbackURL } = (await request.json()) as { email: string; callbackURL: string };
      if (!fromApp || !callbackURL.startsWith(APP_ORIGIN)) return json({ message: "Invalid callbackURL" }, 403);
      const token = `link${++next}`;
      const code = String(428_190 + next);
      links.set(token, email);
      codes.set(email, { code, tries: 0 });
      emailed.push({ email, callbackURL, link: `${TEST_BASE_URL}${APP_SIGN_IN_PATH}?token=${token}`, code });
      return json({ status: true });
    }
    if (path === "/sign-in/email-otp" && request.method === "POST") {
      const { email, otp } = (await request.json()) as { email: string; otp: string };
      if (!fromApp) return json({ message: "Invalid origin" }, 403);
      const pending = codes.get(email);
      if (!pending) return json({ code: "INVALID_OTP", message: "Invalid OTP" }, 400);
      if (pending.tries >= 5) {
        codes.delete(email);
        return json({ code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" }, 403);
      }
      if (otp !== pending.code) {
        pending.tries += 1;
        return json({ code: "INVALID_OTP", message: "Invalid OTP" }, 400);
      }
      codes.delete(email);
      for (const [link, to] of links) if (to === email) links.delete(link);
      return signedIn(email);
    }
    if (path === "/magic-link/verify" && request.method === "GET") {
      const email = links.get(url.searchParams.get("token") ?? "");
      // Better Auth answers every failure with a redirect to its error address (the home page, `error=INVALID_TOKEN`),
      // which React Native's fetch follows whatever `redirect` asks: what reaches the app is that page, a 200.
      if (!email) return fetch(`${TEST_BASE_URL}/?error=INVALID_TOKEN`);
      links.delete(url.searchParams.get("token")!);
      codes.delete(email);
      return signedIn(email);
    }
    const found = sessionOf(request.headers);
    const secondStep = url.pathname === SECOND_STEP_ENDPOINT || url.pathname === SECOND_STEP_PASSKEY_ENDPOINT;
    if (found?.session?.pending && path !== "/sign-out" && !secondStep) return json({ error: SECOND_STEP_REQUIRED }, 401);
    if (secondStep) {
      if (!found?.session) return json({ error: "unauthorized" }, 401);
      if (request.method !== "GET" && !fromApp) return json({ error: "forbidden" }, 403);
      return answerSecondStep(request, url.pathname, found.session);
    }
    // The Candidate's reads: a session pending its second step reaches none (above), as on the web app (#688). The
    // account's own (the Espace coach entry, the legal steps; #689) are answered with its writes, below.
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/") && request.method === "GET" && !ACCOUNT_READS.has(url.pathname)) {
      const as = found?.session?.email ?? null;
      reads.push({ path: `${url.pathname}${url.search}`, as });
      const failure = failing.get(url.pathname);
      if (failure) {
        if (--failure.times === 0) failing.delete(url.pathname);
        return json({ error: "internal_error" }, failure.status);
      }
      return read(url.pathname, as);
    }
    if (path === "/get-session" && request.method === "GET") {
      if (!found?.session) return json(null, 200, found ? cleared : undefined);
      return json({ session: { id: found.token, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: found.session.email, email: found.session.email, name: "" } });
    }
    if (path === "/sign-out" && request.method === "POST") {
      if (!fromApp) return json({ message: "Invalid origin" }, 403);
      if (found) sessions.delete(found.token);
      return json({ success: true }, 200, cleared);
    }
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
      const email = found?.session?.email;
      if (!email) return json({ error: "unauthorized" }, 401);
      if (request.method !== "GET" && request.headers.get("origin") !== APP_ORIGIN) return json({ error: "forbidden" }, 403);
      const body = request.method === "GET" ? undefined : await request.text().then((text) => (text ? JSON.parse(text) : undefined));
      recorded.push({ email, method: request.method, path: url.pathname, body, client: request.headers.get(API_CLIENT_HEADER) });
      const current = stepsOf(email);
      if (url.pathname === "/api/coach-space" && request.method === "GET") return json({ humanCoach: humanCoaches.has(email) });
      if (url.pathname === "/api/account/legal-steps" && request.method === "GET") return json(current);
      // apps/web/src/app/api/account/export/route.ts: the Data export, an attachment (#756 follows its redirects).
      if (url.pathname === "/api/account/export" && request.method === "GET") {
        if (exportMovedTo) return new Response(null, { status: 302, headers: { location: exportMovedTo } });
        const headers = { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${EXPORT_FILE_NAME}"` };
        return new Response(JSON.stringify({ account: { email } }), { headers });
      }
      if (url.pathname === "/api/account/acceptances" && request.method === "POST") {
        const { version } = body as { version: string };
        if (current.acceptance?.version !== version) return json({ error: "stale" }, 409);
        steps.set(email, { ...current, acceptance: null });
        return new Response(null, { status: 204 });
      }
      if (url.pathname.startsWith("/api/privacy-change/") && request.method === "DELETE") {
        steps.set(email, { ...current, privacyChange: null });
        return new Response(null, { status: 204 });
      }
      // apps/web/src/app/api/job-searches/route.ts: a Job Search started for one of the Candidate's Profiles (#699).
      if (url.pathname === "/api/job-searches" && request.method === "POST") {
        const { profileId } = (body ?? {}) as { profileId?: string };
        const profile = data.get(email)?.profiles.find((candidate) => candidate.id === profileId);
        if (!profile) return json({ error: "not_found" }, 404);
        if (profile.archived) return json({ error: "archived" }, 409);
        return json({ id: `search${++next}` }, 201);
      }
      if (url.pathname === "/api/account/eu-ai-consent" && request.method === "PUT") {
        steps.set(email, { ...current, euAiConsentGiven: true });
        return json({ givenAt: new Date().toISOString() });
      }
    }
    if (url.pathname === "/") return new Response("<!doctype html><title>Jobbbox</title>", { status: 200, headers: { "content-type": "text/html" } });
    return json({ message: "Not found" }, 404);
  }

  async function answerSecondStep(request: Request, pathname: string, session: Session): Promise<Response> {
    const factors = twoStep.get(session.email);
    if (request.method === "GET") {
      const read: SecondStepRead = !session.pending || !factors ? { step: null } : factors.setup ? { step: "setup" } : { step: "second_step", passkey: factors.passkey, app: factors.app };
      return json(read);
    }
    const body = (await request.json().catch(() => ({}))) as { code?: string; response?: { id?: string; challenge?: string } };
    if (!factors || factors.setup) return json({ error: "not_enabled" }, 409);
    if (pathname === SECOND_STEP_PASSKEY_ENDPOINT && !body.response) {
      if (!factors.passkey) return json({ error: "no_passkey" }, 409);
      session.challenge = `challenge${++next}`;
      return json({ options: { challenge: session.challenge, rpId: new URL(TEST_BASE_URL).hostname, allowCredentials: [{ id: credentialOf(session.email), type: "public-key" }] } });
    }
    if (factors.lockedUntil && factors.lockedUntil > new Date()) return json({ error: "locked", retryAt: factors.lockedUntil.toISOString() }, 429);
    let accepted: boolean;
    if (pathname === SECOND_STEP_PASSKEY_ENDPOINT) {
      const challenge = session.challenge;
      session.challenge = undefined;
      // Only a passkey of the pending session's own account is taken.
      accepted = factors.passkey && Boolean(challenge) && body.response?.challenge === challenge && body.response?.id === credentialOf(session.email);
    } else {
      const code = body.code ?? "";
      accepted = (factors.app && code === APP_CODE) || factors.backupCodes.delete(code);
    }
    if (accepted) {
      factors.failed = 0;
      session.pending = false;
      return json({ ok: true });
    }
    if (++factors.failed >= MAX_FAILED_ATTEMPTS) {
      factors.failed = 0;
      factors.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      return json({ error: "locked", retryAt: factors.lockedUntil.toISOString() }, 429);
    }
    return json({ error: pathname === SECOND_STEP_PASSKEY_ENDPOINT ? "invalid_passkey" : "invalid_code" }, 400);
  }

  const credentialOf = (email: string) => `credential-of-${email}`;
  /** A device whose system answers a passkey request with `sign`. */
  const device = (sign: DevicePasskeys["sign"], supported = true): DevicePasskeys => ({ supported: () => supported, sign });

  return {
    fetch,
    /** The web app's address, as the app reaches it. */
    baseURL: TEST_BASE_URL,
    emailed,
    /** The link the last email to `email` carries. */
    linkFor: (email: string) => emailed.findLast((sent) => sent.email === email)!.link,
    /** The code the last email to `email` carries (#686). */
    codeFor: (email: string) => emailed.findLast((sent) => sent.email === email)!.code,
    /**
     * The account of `email` has Two-step verification, with an authenticator app (by default) and a passkey if said:
     * a magic link leaves its session pending.
     */
    withSecondStep: (email: string, { app = true, passkey = false }: { app?: boolean; passkey?: boolean } = {}) =>
      void twoStep.set(email, { app, passkey, setup: false, backupCodes: new Set([`backup-${email}`]), failed: 0, lockedUntil: null }),
    /** The account of `email` must have Two-step verification and has no factor yet (a Human Coach): its session sets one up first. */
    mustSetUp: (email: string) => void twoStep.set(email, { app: false, passkey: false, setup: true, backupCodes: new Set(), failed: 0, lockedUntil: null }),
    /** The account of `email` set up its authenticator app on the web's page: its sessions are no longer pending. */
    finishSetUp: (email: string) => {
      twoStep.set(email, { app: true, passkey: false, setup: false, backupCodes: new Set([`backup-${email}`]), failed: 0, lockedUntil: null });
      for (const session of sessions.values()) if (session.email === email) session.pending = false;
    },
    /** What the authenticator app of an account with one shows now. */
    appCode: () => APP_CODE,
    /** One of the backup codes of `email`, each serving once. */
    backupCode: (email: string) => `backup-${email}`,
    /** A device holding the passkey of `email`'s account, which the person uses when the system asks. */
    deviceWithPasskeyOf: (email: string) => device(async (request) => ({ id: credentialOf(email), challenge: (request as { challenge: string }).challenge })),
    /** A device with passkeys, where the person does not use one when the system asks. */
    deviceWithoutPasskey: () => device(async () => null),
    /** A device whose system has no passkeys (Android before 9). */
    unsupportedDevice: () => device(async () => null, false),
    /** Mon compte's « Déconnecter partout », on the web. */
    revokeAll: (email: string) => {
      for (const [token, session] of sessions) if (session.email === email) sessions.delete(token);
    },
    sessionCount: () => sessions.size,
    /** `email` is an active Human Coach (ADR-0016), or no longer one. */
    humanCoach: (email: string, active = true) => void (active ? humanCoaches.add(email) : humanCoaches.delete(email)),
    /** What the web app asks of `email` after sign-in (nothing by default, the EU AI Consent given). */
    asks: (email: string, asked: Partial<LegalStepsResponse>) => void steps.set(email, { ...stepsOf(email), ...asked }),
    /** The API calls the app made, oldest first. */
    recorded,
    /** The Data export's route redirects to `url` (another host, a storage's), or answers again (null). */
    exportMovedTo: (url: string | null) => void (exportMovedTo = url),
    /** Whose session a request with `headers` carries, as the web app reads its cookie: the email, or null for none it knows. */
    signedInAs: (headers: HeadersInit | undefined) => sessionOf(new Headers(headers))?.session?.email ?? null,
    setOffline: (value: boolean) => void (offline = value),
    /** The Sign-in Providers shown to Candidates (#687). */
    offerProviders: (shown: SignInProviderButton[]) => void (providers = shown),
    /** What the person does at the provider, the next times the browser opens. */
    atProvider: (what: AtProvider) => void (atProvider = what),
    /** The system's authentication browser, for createAppSession. */
    browser,
    /** What the browser was opened on, and the return address it waits for. */
    browserOpened,
    /** The sign-ins through a provider the app asked for. */
    signInsAsked: () => signInsAsked,
    /** What `email`'s Candidate has on the web app, as its reads answer it. */
    has: (email: string, candidate: CandidateData) =>
      void data.set(email, {
        profiles: (candidate.profiles ?? []).map((profile) => profileResponseSchema.parse(profile)),
        agenda: agendaResponseSchema.parse(candidate.agenda ?? NO_AGENDA),
        applications: (candidate.applications ?? []).map(({ application, documents }) => ({
          application: applicationResponseSchema.parse(application),
          documents: tailoredDocumentsResponseSchema.parse(documents),
        })),
        offerBox: offerBoxResponseSchema.parse(candidate.offerBox ?? NO_OFFER_BOX),
      }),
    /** The Candidate's reads the app made, in order, and with whose session. */
    reads,
    /** The next `times` calls to the read at `path` fail with `status`, as a server error would. */
    failNext: (path: string, status = 500, times = 1) => void failing.set(path, { status, times }),
  };
}
