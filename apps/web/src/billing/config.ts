import { sharedPool } from "../database/pool";
import type { BillingConfig, StripeConfig } from "./index";

type Env = Record<string, string | undefined>;

const COACHING_SESSION_PRICE_VARIABLES = ["STRIPE_PRICE_COACHING_SESSION", "STRIPE_PRICE_COACHING_SESSION_PREMIUM"] as const;
const STRIPE_VARIABLES = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STANDARD", "STRIPE_PRICE_PREMIUM"] as const;

/**
 * Reads the billing configuration from environment variables (see
 * .env.example). Stripe is optional in development (quotas still apply, nobody
 * can change Plan) and required in production.
 */
export function billingConfigFromEnv(env: Env): BillingConfig {
  const production = env.NODE_ENV === "production";
  if (!env.DATABASE_URL) throw new Error("Missing environment variable DATABASE_URL");

  let stripe: StripeConfig | undefined;
  if (production || STRIPE_VARIABLES.some((name) => env[name])) {
    const missing = STRIPE_VARIABLES.filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing environment variable ${missing.join(", ")}`);
    if (!production && env.STRIPE_SECRET_KEY!.startsWith("sk_live_")) {
      throw new Error("A live Stripe key is only allowed in production; use a test-mode key (sk_test_…)");
    }
    requirePriceIds(env, ["STRIPE_PRICE_STANDARD", "STRIPE_PRICE_PREMIUM"]);
    let coachingSessionPrices: StripeConfig["coachingSessionPrices"];
    if (COACHING_SESSION_PRICE_VARIABLES.some((name) => env[name])) {
      const missingPrice = COACHING_SESSION_PRICE_VARIABLES.filter((name) => !env[name]);
      if (missingPrice.length) throw new Error(`Missing environment variable ${missingPrice.join(", ")}`);
      requirePriceIds(env, COACHING_SESSION_PRICE_VARIABLES);
      coachingSessionPrices = { regular: env.STRIPE_PRICE_COACHING_SESSION!, premium: env.STRIPE_PRICE_COACHING_SESSION_PREMIUM! };
    }
    stripe = {
      secretKey: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
      prices: { standard: env.STRIPE_PRICE_STANDARD!, premium: env.STRIPE_PRICE_PREMIUM! },
      coachingSessionPrices,
      apiUrl: env.STRIPE_API_URL || undefined,
    };
  }

  return {
    database: sharedPool(env),
    baseURL: env.APP_URL || (production ? missingAppUrl() : "http://localhost:3000"),
    stripe,
  };
}

/**
 * Stripe Price IDs start with `price_`. A product ID (`prod_…`) is the usual
 * mix-up, and Stripe would only reject it at the first checkout.
 */
function requirePriceIds(env: Env, names: readonly string[]): void {
  for (const name of names) {
    const value = env[name]!;
    if (value.startsWith("price_")) continue;
    const hint = value.startsWith("prod_")
      ? " That is a Stripe product ID (prod_…); open the product in Stripe and copy its price's ID instead."
      : "";
    throw new Error(`Environment variable ${name} must be a Stripe price ID (starts price_).${hint}`);
  }
}

function missingAppUrl(): never {
  throw new Error("Missing environment variable APP_URL");
}
