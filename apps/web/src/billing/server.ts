import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getCoachingConnect, getConnectStripe } from "@/coaching-connect/server";
import { getCoachingOffers } from "@/coaching-offers/server";
import type { Locale } from "@jobhub/shared/i18n";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getMailer } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getOrders } from "@/orders/server";
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
 * Coaching Sessions go to the Human Coaches module, every paid Checkout to Orders (#512: its confirmation), refunds' fates
 * to Withdrawals (#511); each Stripe call to AI Usage's
 * external APIs. Cancellations are acknowledged through the app's mailer (Brevo).
 */
export function getBilling(): Billing {
    instance ??= liveObject(getSecretResolver(), STRIPE_SECRET_NAMES, (env) => createBilling({
        ...billingConfigFromEnv(env),
        coachSpaceV2: coachSpaceV2On,
        connectedCoachingCheckout: (candidate, quoteId, locale, urls) => getCoachingConnect().startCheckout(candidate, quoteId, locale, urls),
        onConnectedCoachingPaid: async (session) => { const stripe = getConnectStripe(); if (!stripe)
            throw new Error("Connect unavailable"); await getCoachingConnect().paid(stripe.decodeCheckout(session), null); },
        connectedCoachingPayment: id => getCoachingConnect().contextForCheckout(id),
        onCoachingSessionPaid: (paid) => getHumanCoaches().recordPaidSession(paid, within => getCoachingOffers().attachPaid(paid, within)),
        onCheckoutPaid: (paid) => getOrders().paid(paid),
        onRefundChanged: async (change) => { await getWithdrawals().refundChanged(change); await getCoachingRefunds().changed(change.id, null); },
        externalApis: getExternalApiLog(),
        mailer: getMailer(),
    }));
    return instance;
}
/**
 * The payment failed notice for the workspace banner, or null. Never fails the
 * page it is on: if billing cannot be read, there is simply no banner.
 */
export async function getPaymentFailedNotice(candidateId: string, locale: Locale, inApp: boolean): Promise<PaymentFailedNotice | null> {
    try {
        return paymentFailedNotice((await getBilling().entitlements(candidateId)).stripeStatus, locale, inApp);
    }
    catch (error) {
        console.error("[billing] could not read the subscription status", error);
        return null;
    }
}
