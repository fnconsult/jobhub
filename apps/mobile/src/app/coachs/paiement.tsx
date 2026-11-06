import { APP_PAYMENT_CANCELLED } from "@jobhub/shared";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { inAppBrowser } from "../../coaching/in-app-browser";
import { paymentReturn } from "../../coaching/payment-return";
import { paths } from "../../navigation/pages";

/**
 * Stripe Checkout's return (APP_COACHING_PAYMENT_PATH, #694), the universal link the system opens the app with: the
 * in-app browser is closed and Mes coachs humains waits for Stripe's webhook to record the Coaching Session, or says
 * nothing was paid (`?annule=1`). The return itself records nothing (ADR-0016).
 */
export default function CoachingPaymentReturn() {
  const query = useLocalSearchParams();
  const cancelled = query[APP_PAYMENT_CANCELLED] !== undefined;
  useEffect(() => {
    paymentReturn.returned(cancelled);
    inAppBrowser.dismiss();
  }, [cancelled]);
  return <Redirect href={paths.humanCoaches} />;
}
