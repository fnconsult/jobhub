/**
 * The app's calls to the platform's API (ADR-0076): every screen reads and writes through `useApi()`, never `fetch`.
 * There is one client: the web app's `Api` (`createApi`, src/api/web-api.ts) the app is given (`appApi`), or, when none
 * is, one over the global fetch to the platform the build points at (src/web-app-url.ts, set per EAS profile in
 * eas.json). Each call states the API Version the app speaks and names the app as a mobile client.
 *
 * When the platform no longer serves that API Version it answers `426 Upgrade Required` (ADR-0063) to any call, a read
 * or a message to the coach: from then on the provider shows « Mettre à jour Jobbbox » in place of the app, with the
 * link to its store, and the call rejects with AppOutdatedError. The app is never let back in until it is updated: a
 * newer build is a new install.
 */
import { APP_OUTDATED } from "@jobhub/shared/api-version";
import Constants from "expo-constants";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { UpdateRequired } from "../screens/UpdateRequired";
import { WEB_APP_URL } from "../web-app-url";
import { storePageFor } from "./store-page";
import { apiOver, createApi, type Api } from "./web-api";

/** The platform answered 426: this build speaks an API Version it no longer serves. */
export class AppOutdatedError extends Error {
  constructor() {
    super("This build of the app speaks an API Version the platform no longer serves (426)");
    this.name = "AppOutdatedError";
  }
}

const UPGRADE_REQUIRED = 426;

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({
  api,
  baseUrl = WEB_APP_URL,
  fetch = globalThis.fetch,
  storePage = storePageFor(Platform.OS, Constants.expoConfig),
  cookie,
  children,
}: {
  /** The web app's API the app calls (`appApi`, `createApi`); without it, one over `fetch` to `baseUrl` with `cookie`. */
  api?: Api;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** The session cookie to send, as `@better-auth/expo` gives it (empty when signed out); none outside a session. */
  cookie?: () => Promise<string>;
  /** This build's store page, used when the platform's 426 names none. */
  storePage?: string;
  children: ReactNode;
}) {
  const [outdated, setOutdated] = useState<{ storeUrl: string } | null>(null);

  const gated = useMemo<Api>(() => {
    const client = api ?? createApi({ baseURL: baseUrl, cookie: cookie ?? (async () => ""), fetch });
    return apiOver(async (path, init) => {
      const response = await client.fetch(path, init);
      if (response.status === UPGRADE_REQUIRED) {
        const named = await namedStorePage(response);
        setOutdated({ storeUrl: named ?? storePage });
        throw new AppOutdatedError();
      }
      return response;
    });
  }, [api, baseUrl, fetch, storePage, cookie]);

  if (outdated) return <UpdateRequired storeUrl={outdated.storeUrl} />;
  return <ApiContext.Provider value={gated}>{children}</ApiContext.Provider>;
}

/** The app's calls to the API, under the 426 gate; only inside ApiProvider. */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi() is called outside ApiProvider");
  return api;
}

/**
 * The store page a 426's body names (`storeUrl`), if it names one for the app: only under APP_OUTDATED. Any other code
 * (the extension's, EXTENSION_OUTDATED) names another client's store page, which the app never opens.
 */
async function namedStorePage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown; storeUrl?: unknown };
    if (body.error !== APP_OUTDATED) return null;
    return typeof body.storeUrl === "string" && /^https:\/\//.test(body.storeUrl) ? body.storeUrl : null;
  } catch {
    return null;
  }
}
