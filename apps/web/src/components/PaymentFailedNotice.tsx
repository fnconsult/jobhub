"use client";

import { usePathname } from "next/navigation";
import type { PaymentFailedNotice as Notice } from "@/billing/payment-failed-notice";
import { routes } from "@/routes";

/**
 * Tells the Candidate their last payment failed (past_due), with the button to
 * the Stripe customer portal where they update their payment method. A status,
 * not an alert: it never stops them from working.
 */
export function PaymentFailedNotice({ notice, className }: { notice: Notice; className?: string }) {
  return (
    <section className={`notice notice-payment-failed${className ? ` ${className}` : ""}`} role="status">
      <p>{notice.message}</p>
      <form method="post" action={notice.portal}>
        <button className="button button-primary" type="submit">
          {notice.action}
        </button>
      </form>
    </section>
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
