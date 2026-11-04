/**
 * The app's session (ADR-0076, #685): the web app's own Better Auth session, signed in by magic link, held by
 * `@better-auth/expo` in the Keychain or Keystore (expo-secure-store) and sent back as the session cookie, never a
 * bearer token. Revocation from Mon compte, the pending session of Two-step verification (ADR-0075) and the sign-in
 * method work as on the web, since the server sees the same session.
 *
 * The magic link asked from here points at APP_SIGN_IN_PATH, which the app claims by a universal link and an App
 * Link: the system opens the app with it, and `openLink` verifies its token here, once, so the session lands on the
 * device rather than in a browser.
 */
import { expoClient } from "@better-auth/expo/client";
import { APP_ORIGIN, APP_SCHEME, APP_SIGN_IN_PATH, SECOND_STEP_REQUIRED } from "@jobhub/shared";
import { createAuthClient } from "better-auth/client";
import { magicLinkClient } from "better-auth/client/plugins";

/** What the app is, as far as its session goes. */
export type SessionState =
  | { kind: "signedOut" }
  /** Signed in by magic link on an account with Two-step verification: the second step comes before anything else. */
  | { kind: "secondStep" }
  | { kind: "signedIn"; email: string };

/** What opening a sign-in link gives: the session it signed in, or that the link is no longer valid. */
export type LinkOutcome = SessionState | { kind: "invalidLink" };

/** Secure storage, as expo-secure-store offers it (the Keychain on iOS, the Keystore on Android). */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AppSession {
  /** Emails a magic link to `email` for the app; false when the web app refused or could not be reached. */
  askLink(email: string): Promise<boolean>;
  /** Signs in with a magic link the app was opened with; null when `url` is not one. */
  openLink(url: string): Promise<LinkOutcome | null>;
  /** The session as the web app reads it now; a session it no longer knows (revoked, expired) is forgotten here too. Throws offline. */
  current(): Promise<SessionState>;
  /** Revokes the session on the web app, as signing out there does, and empties secure storage, reachable or not. */
  signOut(): Promise<void>;
}

/** The keys of secure storage the session is kept under. */
const STORAGE_PREFIX = "jobbbox";
const STORED = [`${STORAGE_PREFIX}_cookie`, `${STORAGE_PREFIX}_session_data`];
/** Where the app asks its magic link to return (app-sign-in.ts on the web turns it into APP_SIGN_IN_PATH). */
const RETURN_ADDRESS = `${APP_ORIGIN}${APP_SIGN_IN_PATH}`;

export function createAppSession({ baseURL, storage, fetch = globalThis.fetch }: { baseURL: string; storage: SessionStorage; fetch?: typeof globalThis.fetch }): AppSession {
  const client = createAuthClient({
    baseURL,
    // The session is asked of the web app each time: a revocation shows at the next request, never hidden by a cache.
    plugins: [expoClient({ scheme: APP_SCHEME, storagePrefix: STORAGE_PREFIX, storage, disableCache: true }), magicLinkClient()],
    fetchOptions: { customFetchImpl: fetch },
  });
  const forget = () => Promise.all(STORED.map((key) => storage.deleteItemAsync(key))).then(() => undefined);

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

  return {
    async askLink(email) {
      try {
        const { error } = await client.signIn.magicLink({ email, callbackURL: RETURN_ADDRESS });
        return !error;
      } catch {
        return false;
      }
    },

    async openLink(url) {
      const token = signInToken(url, baseURL);
      if (!token) return null;
      const { error } = await client.magicLink.verify({ query: { token } });
      if (error) return { kind: "invalidLink" };
      return current();
    },

    current,

    async signOut() {
      try {
        await client.signOut();
      } catch {
        // Offline: the session stays on the web app until it expires or is revoked from Mon compte, never on the device.
      }
      await forget();
    },
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
