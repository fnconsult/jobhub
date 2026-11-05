/**
 * The app's calls to the platform's API (ADR-0076): every screen reads and writes through `useApi()`, never `fetch`.
 *
 * Each call goes to the platform the build points at (src/web-app-url.ts, set per EAS profile in eas.json), states the
 * API Version the app speaks and names the app as a mobile client (`@jobhub/shared/api-version`). When the platform no
 * longer serves that API Version it answers `426 Upgrade Required` (ADR-0063): from then on the provider shows
 * « Mettre à jour Jobbbox » in place of the app, with the link to its store, and the call rejects with AppOutdatedError.
 * The app is never let back in until it is updated: a newer build is a new install.
 */
import { API_CLIENT_HEADER, API_VERSION, API_VERSION_HEADER, APP_OUTDATED, MOBILE_CLIENT } from "@jobhub/shared/api-version";
import Constants from "expo-constants";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { UpdateRequired } from "../screens/UpdateRequired";
import { WEB_APP_URL } from "../web-app-url";
import { storePageFor } from "./store-page";

/** A call to the API: a path under the platform's address (`/api/…`), as `fetch` takes it. */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The platform answered 426: this build speaks an API Version it no longer serves. */
export class AppOutdatedError extends Error {
  constructor() {
    super("This build of the app speaks an API Version the platform no longer serves (426)");
    this.name = "AppOutdatedError";
  }
}

const UPGRADE_REQUIRED = 426;


const ApiContext = createContext<ApiFetch | null>(null);

export function ApiProvider({
  baseUrl = WEB_APP_URL,
  fetch = globalThis.fetch,
  storePage = storePageFor(Platform.OS, Constants.expoConfig),
  children,
}: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** This build's store page, used when the platform's 426 names none. */
  storePage?: string;
  children: ReactNode;
}) {
  const [outdated, setOutdated] = useState<{ storeUrl: string } | null>(null);

  const api = useCallback<ApiFetch>(
    async (path, init) => {
      const headers = new Headers(init?.headers);
      headers.set(API_VERSION_HEADER, String(API_VERSION));
      headers.set(API_CLIENT_HEADER, MOBILE_CLIENT);
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
      if (response.status === UPGRADE_REQUIRED) {
        const named = await namedStorePage(response);
        setOutdated({ storeUrl: named ?? storePage });
        throw new AppOutdatedError();
      }
      return response;
    },
    [baseUrl, fetch, storePage],
  );

  const value = useMemo(() => api, [api]);
  if (outdated) return <UpdateRequired storeUrl={outdated.storeUrl} />;
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** The app's calls to the API; only inside ApiProvider. */
export function useApi(): ApiFetch {
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
