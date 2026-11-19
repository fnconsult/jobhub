"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { gettingStarted, installsChromeExtensions, type BrowserTraits, type GettingStartedAccount, type GettingStartedItem, type HelpLocale } from "@/coach-help";
import { useHelpSettings } from "./settings";

export type { GettingStartedAccount, GettingStartedItem } from "@/coach-help";

const Account = createContext<GettingStartedAccount | null>(null);

/**
 * « Pour bien commencer » (#1069) in the browser: the signed-in Candidate's account as the server read it for this page
 * (`currentGettingStarted`), null after its first 14 days or signed out. Without it, the section is not shown.
 */
export function GettingStartedProvider({ account, children }: { account: GettingStartedAccount | null; children: ReactNode }) {
  return <Account.Provider value={account}>{children}</Account.Provider>;
}

const unchanging = () => () => {};
/** Whether this browser installs the extension; false on the server, which cannot know, and so during hydration. */
const browserInstallsExtensions = () => installsChromeExtensions(navigator as Navigator & BrowserTraits);

/** « Pour bien commencer »'s items on this page, in their order: from the account the server read and this browser. */
export function useGettingStarted(locale: HelpLocale): GettingStartedItem[] {
  const account = useContext(Account);
  const settings = useHelpSettings();
  const installsExtensions = useSyncExternalStore(unchanging, browserInstallsExtensions, () => false);
  return gettingStarted(account, { now: new Date(), installsExtensions }, locale, settings);
}
