import { readShareLink, SHARE_PATH, type SharedContent } from "@jobhub/shared";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * What another app's share sheet gave the app (Share capture, #697), held until the capture screen sends it or the person
 * cancels: in memory alone, never on the device, so nothing of it outlives the app's process. It is held as soon as the
 * share link opens the app, so a sign-in in between (the magic link opens the app at another address) leaves it waiting:
 * the signed-in app then comes back to the capture screen (`useResumeShare`).
 */
let held: SharedContent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Holds `shared` for the capture screen, in place of anything held before. */
export function holdShare(shared: SharedContent) {
  held = shared;
  changed();
}

/** Forgets what was shared: sent, or cancelled. */
export function forgetShare() {
  held = null;
  changed();
}

/** What is held for the capture screen, or null. */
export const pendingShare = () => held;

/** What is held for the capture screen, kept up to date. */
export const usePendingShare = () =>
  useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => held,
  );

/** Holds what the share link `link` carries, whenever the system opens the app with one. */
export function useHoldShareFrom(link: string | null) {
  useEffect(() => {
    const shared = readShareLink(link);
    if (shared) holdShare(shared);
  }, [link]);
}

/**
 * Opens the capture screen (`navigate`) on what is held, once for each share, from whatever page `pathname` the signed-in
 * app shows: after a sign-in that opened the app at another address, or a share that arrived meanwhile. Leaving the
 * screen without sending is the person's choice: they are not brought back to it.
 */
export function useResumeShare(pathname: string, navigate: (path: string) => void) {
  const shared = usePendingShare();
  const resumed = useRef<SharedContent | null>(null);
  useEffect(() => {
    if (!shared || resumed.current === shared) return;
    resumed.current = shared;
    if (pathname !== SHARE_PATH) navigate(SHARE_PATH);
  }, [shared, pathname, navigate]);
}
