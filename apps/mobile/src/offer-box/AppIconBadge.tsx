import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useOffersToHandle } from "../api/reads";
import { setIconBadge } from "../push/device";

/**
 * The app icon's badge (#818, ADR-0090): the Offer box's offers à traiter (`GET /api/offer-box/count`), set as the
 * signed-in app opens and read again each time it comes back to the foreground; set again only when the count changed.
 * Left as it is when the count cannot be read. The Push notifications already sent set it too (the worker's `badge`).
 * No push of its own. Draws nothing.
 */
export function AppIconBadge({ setBadge = setIconBadge }: { setBadge?: (count: number) => Promise<unknown> }) {
  const { data, refetch } = useOffersToHandle();
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => foreground.remove();
  }, [refetch]);

  const count = data?.toHandle;
  useEffect(() => {
    if (count === undefined || count === shown.current) return;
    shown.current = count;
    void setBadge(count);
  }, [count, setBadge]);

  return null;
}
