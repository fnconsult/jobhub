"use client";

import { usePathname } from "next/navigation";
import type { PaymentFailedNotice as Notice } from "@/billing/payment-failed-notice";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { routes } from "@/routes";

/**
 * Tells the Candidate their last payment failed (past_due), with the button to
 * the Stripe customer portal where they update their payment method: the
 * failed-payment Note, a warning (#469). A status, not an alert: it never stops
 * them from working.
 */
export function PaymentFailedNotice({ notice, className }: { notice: Notice; className?: string }) {
  return (
    <div className={["payment-failed", className].filter(Boolean).join(" ")}>
      <Note tone="warn" role="status">
        <p>{notice.message}</p>
        <form method="post" action={notice.portal}>
          <button className={buttonClass({ variant: "primary" })} type="submit">
            {notice.action}
          </button>
        </form>
      </Note>
    </div>
  );
}

/**
 * The notice as a banner atop every page of the signed-in workspace (the
 * sidebar layout, CandidateLayout), except the subscription page, which shows
 * it next to the current Plan instead.
 */
export function PaymentFailedBanner({ notice }: { notice: Notice }) {
  const pathname = usePathname();
  if (pathname === routes.subscription) return null;
  return <PaymentFailedNotice notice={notice} className="payment-failed-banner" />;
}
