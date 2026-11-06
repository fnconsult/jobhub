/**
 * The app's session (ADR-0076, #685): the web app's own Better Auth session, signed in by magic link, held by
 * `@better-auth/expo` in the Keychain or Keystore (expo-secure-store) and sent back as the session cookie, never a
 * bearer token. Revocation from Mon compte, the pending session of Two-step verification (ADR-0075) and the sign-in
 * method work as on the web, since the server sees the same session.
 *
 * The magic link asked from here points at APP_SIGN_IN_PATH, which the app claims by a universal link and an App
 * Link: the system opens the app with it, and `openLink` verifies its token here, once, so the session lands on the
 * device rather than in a browser. The email also carries a code (#686), for a Candidate who reads it on another
 * device: `enterCode` signs in with it, the session landing here just the same.
 *
 * A session pending its second step (ADR-0075) takes it here (#688), on the web's own endpoints and with their limits:
 * an authenticator app's code, a backup code or a passkey of the account's own, which the system is asked for
 * (`passkeys`). Nothing of it is kept on the device; the session's cookie stays the same, no longer pending.
 *
 * The web pages the app opens in a WebView (src/web-pages: the second step's setup; Mon compte, the subscription, the
 * Legal Texts, the Coach space, #689) are signed in by the same cookie, given to the WebViews' cookie store for the web
 * app's own host alone (`webCookies`); signing out, or a session the web app no longer knows, empties that store too.
 *
 * A Sign-in Provider shown to Candidates (#687) signs in by the web's own OAuth flow, never by an ID token (ADR-0011):
 * `continueWith` asks it without a redirect, opens the provider through Better Auth's Expo proxy in the system's
 * authentication browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android), and waits for the app's scheme at
 * APP_PROVIDER_RETURN_PATH: the callback, where the linking rules apply unchanged, sends it the session cookie, or the
 * refusal's code. Such a sign-in counts as both steps (ADR-0075).
 */
import { expoClient, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import {
  APP_ORIGIN,
  APP_PROVIDER_RETURN_PATH,
  APP_SCHEME,
  APP_SIGN_IN_PATH,
  SECOND_STEP_ENDPOINT,
  SECOND_STEP_PASSKEY_ENDPOINT,
  SECOND_STEP_REQUIRED,
  secondStepReadSchema,
  signInCodeRefusal,
  typedSignInCode,
  type SignInCodeRefusal,
} from "@jobhub/shared";
import { cancelledAtProvider, signInProvidersResponseSchema, type SignInProviderButton } from "@jobhub/shared/sign-in-providers";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";

/** What the app is, as far as its session goes. */
export type SessionState =
  | { kind: "signedOut" }
  /** Signed in by magic link on an account with Two-step verification: the second step comes before anything else. */
  | { kind: "secondStep" }
  | { kind: "signedIn"; email: string };

/** What opening a sign-in link gives: the session it signed in, or that the link is no longer valid. */
export type LinkOutcome = SessionState | { kind: "invalidLink" };

/** What typing the email's code gives: the session it signed in, or why it was refused (a catalogue key). */
export type CodeOutcome = SessionState | { kind: "codeRefused"; reason: SignInCodeRefusal };

/**
 * What a sign-in through a Sign-in Provider gives: the session it signed in; cancelled, the person having closed the
 * browser or left the provider's page; or refused, with the code the web app came back with (`provider_disabled`,
 * `account_not_linked`…, said as on the web: signInCopy), `unreachable` or `no_session` when nothing came back.
 */
export type ProviderOutcome = SessionState | { kind: "cancelled" } | { kind: "providerRefused"; error: string };

/**
 * The system's authentication browser, as expo-web-browser's `openAuthSessionAsync` opens it on `url` and closes it on
 * `returnUrl`: `success` with the address it closed on, anything else when the person closed it.
 */
export type AuthBrowser = (url: string, returnUrl: string) => Promise<{ type: "success"; url: string } | { type: string }>;

/** Secure storage, as expo-secure-store offers it (the Keychain on iOS, the Keystore on Android). */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * What a session pending its step can do: its second step, with the authenticator app's code if the account has one
 * (`app`; a backup code works either way) and its passkey if it has one and the device can use it (`passkey`); or, for
 * an account that must have Two-step verification and has no factor yet (a Human Coach), set it up on the web first.
 */
export type SecondStepChoice = { kind: "factors"; app: boolean; passkey: boolean } | { kind: "setup" };

/**
 * How a second step went: the session it leaves (signed in); or refused, the session still pending: a wrong code or a
 * passkey not of this account (`invalid`), too many wrong ones (`locked` until `retryAt`), the passkey not used
 * (`cancelled`), or the web app not reached or not answering (`error`).
 */
export type SecondStepOutcome =
  | { ok: true; session: SessionState }
  | { ok: false; error: "invalid" | "cancelled" | "error" }
  | { ok: false; error: "locked"; retryAt: Date };

/** The WebViews' cookie store (react-native-webview's: the WebKit store on iOS, the shared one on Android), #689. */
export interface WebViewCookies {
  /** Empties the store: no WebView sends anything of the session any more. */
  clear(): Promise<void>;
}

/** The system's passkeys (src/session/device-passkeys.ts): the Keychain's on iOS, Credential Manager's on Android. */
export interface DevicePasskeys {
  /** Whether the system can use a passkey on this device. */
  supported(): boolean;
  /** The system's answer to `request` (WebAuthn's options, as JSON), a passkey of the site signing it; null when none was used. */
  sign(request: unknown): Promise<unknown | null>;
}

export interface AppSession {
  /** The web app it is a session of (its pages open in a WebView, src/web-pages). */
  readonly baseURL: string;
  /** Emails a magic link to `email` for the app; false when the web app refused or could not be reached. */
  askLink(email: string): Promise<boolean>;
  /** Signs in with a magic link the app was opened with; null when `url` is not one. */
  openLink(url: string): Promise<LinkOutcome | null>;
  /** Signs in with the code of the email sent to `email`, as typed (#686). */
  enterCode(email: string, code: string): Promise<CodeOutcome>;
  /** The Sign-in Providers shown to Candidates, as the web's sign-in page reads them; none when the web app cannot be reached. */
  providers(): Promise<SignInProviderButton[]>;
  /** Signs in through Sign-in Provider `providerId`, in the system's authentication browser (#687). */
  continueWith(providerId: string): Promise<ProviderOutcome>;
  /** The session as the web app reads it now; a session it no longer knows (revoked, expired) is forgotten here too. Throws offline. */
  current(): Promise<SessionState>;
  /** Revokes the session on the web app, as signing out there does, and empties secure storage and the WebViews' cookies, reachable or not. */
  signOut(): Promise<void>;
  /** What the session pending its step can do; null when it has nothing pending. Throws when the web app cannot be reached. */
  secondStep(): Promise<SecondStepChoice | null>;
  /** The second step with the authenticator app's code or a backup code. */
  verifyCode(code: string): Promise<SecondStepOutcome>;
  /** The second step with a passkey of the account's own, asked of the system. */
  verifyPasskey(): Promise<SecondStepOutcome>;
  /** The session's cookies, for a WebView of the web app to send to its host alone (src/web-pages); none when signed out. */
  webCookies(): Promise<{ name: string; value: string }[]>;
  /**
   * The session cookie, for a request to the web app made outside the session's own client (the app's calls to the
   * API, src/api; a Tailored Document's download, #695): the `Cookie` header Better Auth reads; empty when signed out.
   */
  cookie(): Promise<string>;
  /**
   * Empties the WebViews' cookie store (#689), as signing out and a session found gone do, the session itself kept: for
   * SessionGate to forget, with the rest the device kept, before the session is dropped (ADR-0076).
   */
  forgetWebViews(): Promise<void>;
}

/** An endpoint's answer: its status, and its body. */
type Answer = { status: number; body: Record<string, unknown> };

/** The keys of secure storage the session is kept under. */
const STORAGE_PREFIX = "jobbbox";
const COOKIE_KEY = `${STORAGE_PREFIX}_cookie`;
const STORED = [COOKIE_KEY, `${STORAGE_PREFIX}_session_data`];
/** Where the app asks its magic link to return (app-sign-in.ts on the web turns it into APP_SIGN_IN_PATH). */
const RETURN_ADDRESS = `${APP_ORIGIN}${APP_SIGN_IN_PATH}`;
/** Where a Sign-in Provider sends the app back, signed in or refused: the system's browser closes on it. */
const PROVIDER_RETURN_ADDRESS = `${APP_ORIGIN}${APP_PROVIDER_RETURN_PATH}`;

export function createAppSession({
  baseURL,
  storage,
  passkeys,
  webViewCookies,
  fetch = globalThis.fetch,
  browser,
}: {
  baseURL: string;
  storage: SessionStorage;
  passkeys: DevicePasskeys;
  /** The WebViews' cookie store, emptied with the session (#689); none where the app opens no WebView. */
  webViewCookies?: WebViewCookies;
  fetch?: typeof globalThis.fetch;
  /** The system's authentication browser: a Sign-in Provider is refused (`unreachable`) without it. */
  browser?: AuthBrowser;
}): AppSession {
  const client = createAuthClient({
    baseURL,
    // The session is asked of the web app each time: a revocation shows at the next request, never hidden by a cache.
    plugins: [expoClient({ scheme: APP_SCHEME, storagePrefix: STORAGE_PREFIX, storage, disableCache: true }), magicLinkClient(), emailOTPClient()],
    fetchOptions: { customFetchImpl: fetch },
  });
  const forget = () => Promise.all([...STORED.map((key) => storage.deleteItemAsync(key)), webViewCookies?.clear()]).then(() => undefined);
  /** Secure storage as the Expo plugin keeps it (a long value split in parts): the session cookie a provider brings goes there. */
  const kept = storageAdapter(storage);
  const origin = baseURL.replace(/\/$/, "");

  /**
   * The provider's sign-in, opened in the system's browser and followed to the app's return address. The authorization
   * goes through the Expo proxy (`/expo-authorization-proxy`), which keeps the flow's state cookie in that browser for
   * the callback to check; the callback's answer to the app's scheme carries the session's Set-Cookie (`cookie`).
   */
  async function throughProvider(providerId: string): Promise<ProviderOutcome> {
    const refused = (error: string) => ({ kind: "providerRefused", error }) as const;
    if (!browser) return refused("unreachable");
    let authorizationURL: string | undefined;
    try {
      const { data } = await client.signIn.social({ provider: providerId, callbackURL: PROVIDER_RETURN_ADDRESS, errorCallbackURL: PROVIDER_RETURN_ADDRESS, disableRedirect: true });
      authorizationURL = data && "url" in data ? data.url : undefined;
    } catch {
      return refused("unreachable");
    }
    if (!authorizationURL) return refused("unreachable");
    const proxy = `${origin}/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`;
    let result: Awaited<ReturnType<AuthBrowser>>;
    try {
      result = await browser(proxy, PROVIDER_RETURN_ADDRESS);
    } catch {
      // The system would not open it (another one already open, on Android).
      return refused("unreachable");
    }
    if (result.type !== "success" || !("url" in result)) return { kind: "cancelled" };
    const back = new URL(result.url);
    const error = back.searchParams.get("error");
    if (error) return cancelledAtProvider(error) ? { kind: "cancelled" } : refused(error);
    const cookie = back.searchParams.get("cookie");
    if (!cookie) return refused("no_session");
    await kept.setItemAsync(COOKIE_KEY, getSetCookie(cookie, (await kept.getItemAsync(COOKIE_KEY)) ?? undefined));
    // Offline just now: the session is kept, and the next read (back in the foreground) signs the app in.
    return current().catch(() => refused("unreachable"));
  }

  async function current(): Promise<SessionState> {
    const { data, error } = await client.getSession();
    if (error?.status === 401 && (error as { error?: string }).error === SECOND_STEP_REQUIRED) return { kind: "secondStep" };
    if (error && error.status !== 401) throw new Error(`get-session answered ${error.status}`);
    if (!data) {
      await forget();
      return { kind: "signedOut" };
    }
    return { kind: "signedIn", email: data.user.email };
  }

  /**
   * A call to one of the web app's second-step endpoints, with the session's cookie and the app's origin, as the
   * client's own calls (@better-auth/expo): its answer's body, and its status. Throws when the web app cannot be reached.
   */
  async function secondStepCall(path: string, body?: object): Promise<Answer> {
    const { data, error } = await client.$fetch<Record<string, unknown>>(new URL(path, baseURL).toString(), body ? { method: "POST", body } : { method: "GET" });
    if (error) {
      if (!error.status) throw new Error("the web app could not be reached");
      return { status: error.status, body: error as unknown as Record<string, unknown> };
    }
    return { status: 200, body: data ?? {} };
  }

  /** What a second step's answer says: the session it leaves, or why it was refused. */
  async function outcomeOf(call: () => Promise<Answer | "cancelled">): Promise<SecondStepOutcome> {
    let answer: Answer | "cancelled";
    try {
      answer = await call();
    } catch {
      return { ok: false, error: "error" };
    }
    if (answer === "cancelled") return { ok: false, error: "cancelled" };
    const { status, body } = answer;
    if (status === 200) return { ok: true, session: await current().catch((): SessionState => ({ kind: "secondStep" })) };
    // The client's JSON reader turns an ISO date into a Date already.
    const retryAt = typeof body.retryAt === "string" || body.retryAt instanceof Date ? new Date(body.retryAt) : null;
    if (status === 429 && retryAt && !Number.isNaN(retryAt.getTime())) return { ok: false, error: "locked", retryAt };
    return { ok: false, error: body.error === "invalid_code" || body.error === "invalid_passkey" ? "invalid" : "error" };
  }

  // One at a time: a session read that finds none must not forget the cookie a link has just brought.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    baseURL,

    async askLink(email) {
      try {
        const { error } = await client.signIn.magicLink({ email, callbackURL: RETURN_ADDRESS });
        return !error;
      } catch {
        return false;
      }
    },

    openLink(url) {
      const token = signInToken(url, baseURL);
      if (!token) return Promise.resolve(null);
      return serial(async () => {
        // Asked without a return address, the web app answers a valid link with its session, in JSON. It answers every
        // other (used, expired, never valid) with a redirect to its error address, `error=INVALID_TOKEN`, which React
        // Native's fetch follows to a page, a 200 without an error: the session missing from the answer is what tells.
        const { data } = await client.magicLink.verify({ query: { token } });
        if (!data?.token) return { kind: "invalidLink" } as const;
        return current();
      });
    },

    enterCode(email, code) {
      return serial(async (): Promise<CodeOutcome> => {
        try {
          const { data, error } = await client.signIn.emailOtp({ email: email.trim(), otp: typedSignInCode(code) });
          if (error || !data?.token) return { kind: "codeRefused", reason: signInCodeRefusal(error?.code) };
        } catch {
          return { kind: "codeRefused", reason: signInCodeRefusal(undefined) };
        }
        return current();
      });
    },

    async providers() {
      try {
        const response = await fetch(`${origin}/api/sign-in-providers`);
        if (!response.ok) return [];
        const read = signInProvidersResponseSchema.safeParse(await response.json());
        return read.success ? read.data.providers : [];
      } catch {
        return [];
      }
    },

    // One at a time with the session reads: the app back in the foreground as the browser closes must not read the
    // session before the cookie the provider brought is kept.
    continueWith: (providerId) => serial(() => throughProvider(providerId)),

    current: () => serial(current),

    cookie: () => client.getCookie(),

    forgetWebViews: async () => {
      await webViewCookies?.clear();
    },

    signOut: () =>
      serial(async () => {
        try {
          await client.signOut();
        } catch {
          // Offline: the session stays on the web app until it expires or is revoked from Mon compte, never on the device.
        }
        await forget();
      }),

    async secondStep() {
      const { status, body } = await secondStepCall(SECOND_STEP_ENDPOINT);
      if (status !== 200) return null;
      const read = secondStepReadSchema.parse(body);
      if (read.step === null) return null;
      if (read.step === "setup") return { kind: "setup" };
      return { kind: "factors", app: read.app, passkey: read.passkey && passkeys.supported() };
    },

    verifyCode: (code) => outcomeOf(() => secondStepCall(SECOND_STEP_ENDPOINT, { code: code.trim() })),

    async webCookies() {
      const header = await client.getCookie();
      return header
        .split("; ")
        .filter((pair) => pair.includes("="))
        .map((pair) => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1) }));
    },

    verifyPasskey: () =>
      outcomeOf(async () => {
        const challenge = await secondStepCall(SECOND_STEP_PASSKEY_ENDPOINT, {});
        if (challenge.status !== 200) return challenge;
        // The system's sheet: cancelled, or no passkey of the site on the device, the session stays pending.
        const response = await passkeys.sign(challenge.body.options).catch(() => null);
        if (!response) return "cancelled";
        return secondStepCall(SECOND_STEP_PASSKEY_ENDPOINT, { response });
      }),
  };
}

/** The token of a magic link asked from the app (`https://<web app>/connexion/app?token=…`), or null. */
function signInToken(url: string, baseURL: string): string | null {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return null;
  }
  if (link.origin !== new URL(baseURL).origin || link.pathname !== APP_SIGN_IN_PATH) return null;
  return link.searchParams.get("token") || null;
}
