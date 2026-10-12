/**
 * What a Candidate is told while Stripe retries a failed payment of their
 * subscription (past_due): their last payment failed, and the customer portal
 * is where they update their payment method. Shared by the workspace banner
 * and the subscription page, so both say the same thing.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { SubscriptionStatus } from "./index";

export interface PaymentFailedNotice {
  message: string;
  /** Label of the button that opens the Stripe customer portal. */
  action: string;
  /** Where that button posts: the route that opens the Stripe customer portal. */
  portal: string;
}

export const CUSTOMER_PORTAL_ROUTE = "/api/billing/portal";

/** The notice to show for this subscription status, or null when the last payment did not fail. */
export function paymentFailedNotice(status: SubscriptionStatus | null, locale: Locale): PaymentFailedNotice | null {
  if (status !== "past_due") return null;
  const { t } = createI18n(locale);
  return {
    message: t("billing.paymentFailed.message"),
    action: t("billing.paymentFailed.action"),
    portal: CUSTOMER_PORTAL_ROUTE,
  };
}
