import { getSecretResolver } from "@/provider-secrets/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { sharedPool } from "@/database/pool";
import { coachingRefunds } from "./index";
import { coachingRefundStripe } from "./stripe";
/** Owed money is reconciled even if a later rollout/legal gate closes new sales. */
export function getCoachingRefunds() {
  const env = getSecretResolver().current().env;
  return coachingRefunds(sharedPool(), {
    ...(env.STRIPE_SECRET_KEY
      ? { stripe: coachingRefundStripe({ secretKey: env.STRIPE_SECRET_KEY, apiUrl: env.STRIPE_API_URL, externalApis: getExternalApiLog() }) }
      : {}),
  });
}
