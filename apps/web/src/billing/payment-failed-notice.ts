/**
 * What a Candidate is told while Stripe retries a failed payment of their
 * subscription (past_due): their last payment failed, and the customer portal
 * is where they update their payment method. Shared by the workspace banner
 * and the subscription page, so both say the same thing. Inside the Jobbbox
 * app's WebView (#689, App Store guideline 3.1.1), nothing leads to Stripe:
 * the notice says the subscription is managed on jobbbox.ai instead.
 */
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { SubscriptionStatus } from "./index";

export type PaymentFailedNotice = { message: string } & (
  | {
      /** Label of the button that opens the Stripe customer portal. */
      action: string;
      /** Where that button posts: the route that opens the Stripe customer portal. */
      portal: string;
    }
  | {
      /** Inside the app: where the subscription is managed, in place of the button. */
      help: string;
    }
);

export const CUSTOMER_PORTAL_ROUTE = "/api/billing/portal";

/**
 * The notice to show for this subscription status, or null when the last payment did not fail. `inApp`, asked of every
 * caller: whether the page is shown inside the Jobbbox app's WebView (inAppWebView), where there is no way to Stripe.
 */
export function paymentFailedNotice(status: SubscriptionStatus | null, locale: Locale, inApp: boolean): PaymentFailedNotice | null {
  if (status !== "past_due") return null;
  const { t } = createI18n(locale);
  const message = t("billing.paymentFailed.message");
  if (inApp) return { message, help: t("billing.page.manageOnWebHelp") };
  return { message, action: t("billing.paymentFailed.action"), portal: CUSTOMER_PORTAL_ROUTE };
}
