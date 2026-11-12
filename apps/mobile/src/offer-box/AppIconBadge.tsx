import { useEffect } from "react";
import { AppState } from "react-native";
import { useOffersToHandle } from "../api/reads";
import { setIconBadge } from "../push/device";

/**
 * The app icon's badge (#818, ADR-0090): the Offer box's offers à traiter (`GET /api/offer-box/count`), set as the
 * signed-in app opens and again with each read of the count, read again each time the app comes back to the foreground.
 * Set at each read even when the count is the one the app set last: the Push notifications already sent set the badge
 * too (the worker's `aps.badge`, `notification_count`) while the app is away, so the icon may show another number by
 * then. Left as it is when the count cannot be read. No push of its own. Draws nothing.
 */
export function AppIconBadge({ setBadge = setIconBadge }: { setBadge?: (count: number) => Promise<unknown> }) {
  const { data, dataUpdatedAt, refetch } = useOffersToHandle();

  useEffect(() => {
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => foreground.remove();
  }, [refetch]);

  // Keyed by when the count was read, not by the count: a read answering the same number sets the badge again.
  const count = data?.toHandle;
  useEffect(() => {
    if (count !== undefined) void setBadge(count);
  }, [count, dataUpdatedAt, setBadge]);

  return null;
}
