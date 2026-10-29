"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Whether the page is hydrated: false in the server's HTML and while React hydrates it, true from then on. A control
 * used before that does nothing (no handler is attached yet, so the choice or the click is lost), so a control that
 * only acts through React is disabled until this is true: a person, or a test, waits for it to be enabled (#446).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
