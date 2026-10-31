import type { Locale } from "@jobhub/shared/i18n";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getHumanCoaches } from "@/human-coaches/server";
import { getWithdrawals } from "@/withdrawals/server";
import { STRIPE_SECRET_NAMES } from "@/provider-secrets/catalog";
import { liveObject } from "@/provider-secrets/resolver";
import { getSecretResolver } from "@/provider-secrets/server";
import { billingConfigFromEnv } from "./config";
import { createBilling, type Billing } from "./index";
import { paymentFailedNotice, type PaymentFailedNotice } from "./payment-failed-notice";

let instance: Billing | undefined;

/**
 * The app's billing module, configured from the environment with the Provider Secrets
 * over it, and rebuilt when the Stripe keys are replaced in the Back Office. Paid
 * Coaching Sessions go to the Human Coaches module, refunds' fates to Withdrawals (#511); each Stripe call to AI Usage's external APIs.
 */
export function getBilling(): Billing {
  instance ??= liveObject(getSecretResolver(), STRIPE_SECRET_NAMES, (env) =>
    createBilling({
      ...billingConfigFromEnv(env),
      onCoachingSessionPaid: (paid) => getHumanCoaches().recordPaidSession(paid),
      onRefundChanged: (change) => getWithdrawals().refundChanged(change),
      externalApis: getExternalApiLog(),
    }),
  );
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
