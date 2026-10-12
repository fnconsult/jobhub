import type { Locale } from "@jobhub/shared/i18n";
import { getHumanCoaches } from "@/human-coaches/server";
import { billingConfigFromEnv } from "./config";
import { createBilling, type Billing } from "./index";
import { paymentFailedNotice, type PaymentFailedNotice } from "./payment-failed-notice";

let instance: Billing | undefined;

/** The app's billing module, configured from the environment on first use. Paid Coaching Sessions go to the Human Coaches module. */
export function getBilling(): Billing {
  instance ??= createBilling({ ...billingConfigFromEnv(process.env), onCoachingSessionPaid: (paid) => getHumanCoaches().recordPaidSession(paid) });
  return instance;
}

/**
 * The payment failed notice for the workspace banner, or null. Never fails the
 * page it is on: if billing cannot be read, there is simply no banner.
 */
export async function getPaymentFailedNotice(candidateId: string, locale: Locale): Promise<PaymentFailedNotice | null> {
  try {
    return paymentFailedNotice((await getBilling().entitlements(candidateId)).stripeStatus, locale);
  } catch (error) {
    console.error("[billing] could not read the subscription status", error);
    return null;
  }
}
