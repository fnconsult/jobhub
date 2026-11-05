import { createContext, useContext, type ReactNode } from "react";
import type { Api } from "./web-api";

/** Without a provider, every call fails as an unreachable web app would: a screen says so rather than breaking. */
const UNREACHABLE: Api = {
  fetch: () => Promise.reject(new TypeError("No API")),
  read: () => Promise.reject(new TypeError("No API")),
};

const ApiContext = createContext<Api>(UNREACHABLE);

/** The web app's API the screens below call (`createApi`): the app's own, or a test's fake web app. */
export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export const useApi = () => useContext(ApiContext);
