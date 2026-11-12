"use client";

import type { HelpSettings } from "@jobhub/help";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const Settings = createContext<HelpSettings>({});

/**
 * The Help Articles' settings in the browser (#867, ADR-0106): « Espace coach v2 » on or off, as the server read it for
 * this page (`coachSpaceV2On()`). The Coach Panel's help, « Sur cette page » and the page's help links read the articles
 * it serves. Without it, off: the articles main served.
 */
export function HelpSettingsProvider({ coachSpaceV2, children }: { coachSpaceV2: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ coachSpaceV2 }), [coachSpaceV2]);
  return <Settings.Provider value={value}>{children}</Settings.Provider>;
}

/** The Help Articles' settings of this page: pass them to `onThisPage`, `helpSuggestions`, `helpArticle`… */
export function useHelpSettings(): HelpSettings {
  return useContext(Settings);
}
