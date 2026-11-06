import type { CoachingResponse } from "@jobhub/shared/reads";
import { useSyncExternalStore } from "react";

type Session = CoachingResponse["sessions"][number];

/**
 * A Stripe Checkout the Candidate went to from the app (#694), until Mes coachs humains has seen what came of it. The
 * return proves nothing (ADR-0016): the Coaching Session is recorded by Stripe's signed webhook, so the page reads the
 * web app again until a Coaching Session it did not know shows up.
 */
interface Pending {
  /** The Coaching Sessions known when Checkout opened; null when unknown (the app was started again by the return). */
  known: readonly string[] | null;
  /** When the Candidate came back (or Checkout opened, until then): the wait is measured from it. */
  since: number;
  /** How the Candidate came back: by the universal link, paid or having left Checkout, or by closing the browser. */
  how: "paid" | "cancelled" | "closed" | null;
}

/** How long the page reads the web app again on its own before it says the confirmation is slow. */
export const WAIT_MS = 60_000;
/** How often it reads it meanwhile. */
export const POLL_MS = 2_000;

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const changed = (next: Pending | null) => {
  pending = next;
  listeners.forEach((listener) => listener());
};

/** The Checkout under way, as the order, the in-app browser and the universal link report it. */
export const paymentReturn = {
  /** Checkout is about to open, the Candidate's Coaching Sessions being `known` (null when they could not be read). */
  started(known: readonly string[] | null) {
    changed({ known, since: Date.now(), how: null });
  },
  /** The universal link came back (APP_COACHING_PAYMENT_PATH): paid, or `cancelled` when the Candidate left Checkout. */
  returned(cancelled: boolean) {
    changed({ known: pending?.known ?? null, since: Date.now(), how: cancelled ? "cancelled" : "paid" });
  },
  /** The in-app browser closed, or (Android) handed the app back at once: the payment may have gone through or not. */
  closed() {
    if (pending && pending.how === null) changed({ ...pending, since: Date.now(), how: "closed" });
  },
  /** What came of it was shown: nothing is pending any more. */
  done() {
    if (pending) changed(null);
  },
};

/** What Mes coachs humains says of the Checkout under way. */
export type PaymentWait =
  | { kind: "none" }
  /** Waiting for Stripe's webhook: after the universal link (`paid`) or the browser closed (`maybe`); `slow` past WAIT_MS. */
  | { kind: "waiting"; paid: boolean; slow: boolean }
  | { kind: "cancelled" }
  /** The Coaching Session it paid for, recorded. */
  | { kind: "recorded"; session: Session };

/**
 * What came of `checkout` once the web app answered `coaching` (read at `readAt`): the Coaching Session it did not know
 * (by its id, or, when the app was started again by the return, one paid shortly before), otherwise still waiting, or
 * nothing.
 */
export function paymentWait(checkout: Pending | null, coaching: CoachingResponse | undefined, readAt: number): PaymentWait {
  if (!checkout || checkout.how === null) return { kind: "none" };
  if (checkout.how === "cancelled") return { kind: "cancelled" };
  const recorded = coaching?.sessions.find((session) =>
    checkout.known ? !checkout.known.includes(session.id) : new Date(session.paidAt).getTime() >= checkout.since - WAIT_MS,
  );
  if (recorded) return { kind: "recorded", session: recorded };
  return { kind: "waiting", paid: checkout.how === "paid", slow: readAt - checkout.since > WAIT_MS };
}

/** How soon Mes coachs humains reads the web app again, `coaching` read at `readAt`: every POLL_MS while it waits, until slow. */
export function readAgainWhileWaiting(coaching: CoachingResponse | undefined, readAt: number): number | false {
  const wait = paymentWait(pending, coaching, readAt);
  return wait.kind === "waiting" && !wait.slow ? POLL_MS : false;
}

/** The Checkout under way, for the page. */
export function usePendingCheckout(): Pending | null {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => pending,
  );
}
