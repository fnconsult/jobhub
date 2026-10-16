"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Back from Stripe Checkout, the Plan changes only once Stripe's webhook is in
 * (ADR-0014), often a moment after the Candidate lands. While the page still
 * shows the Free Plan, reloads its data every few seconds, without reloading
 * the page; the page stops rendering this once the new Plan shows. Gives up
 * after a while, should the payment never be confirmed. Renders nothing.
 */
export function RefreshUntilPlanConfirmed({ everyMs = 2000, giveUpAfterMs = 60_000 }: { everyMs?: number; giveUpAfterMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > giveUpAfterMs) return clearInterval(timer);
      router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, giveUpAfterMs]);
  return null;
}
