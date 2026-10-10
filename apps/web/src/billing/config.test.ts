import { describe, expect, it } from "vitest";
import { billingConfigFromEnv } from "./config";

const stripeEnv = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  STRIPE_PRICE_STANDARD: "price_std",
  STRIPE_PRICE_PREMIUM: "price_prem",
};

describe("billing configuration from the environment", () => {
  it("connects to Stripe with the paid Plans' prices", async () => {
    const config = billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", APP_URL: "https://app.jobbbox.fr", ...stripeEnv });

    expect(config.baseURL).toBe("https://app.jobbbox.fr");
    expect(config.stripe).toEqual({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
      prices: { standard: "price_std", premium: "price_prem" },
      apiUrl: undefined,
    });
    await config.database.end();
  });

  it("runs without Stripe in development, where nobody can change Plan", async () => {
    const config = billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x" });

    expect(config.stripe).toBeUndefined();
    expect(config.baseURL).toBe("http://localhost:3000");
    await config.database.end();
  });

  it("refuses a half-configured Stripe rather than failing at the first checkout", () => {
    expect(() =>
      billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", STRIPE_SECRET_KEY: "sk_test_123" }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("requires Stripe in production", () => {
    expect(() =>
      billingConfigFromEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://localhost/x", APP_URL: "https://app.jobbbox.fr" }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("refuses a live Stripe key outside production", () => {
    expect(() =>
      billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", ...stripeEnv, STRIPE_SECRET_KEY: "sk_live_123" }),
    ).toThrow(/live/);
  });

  it("refuses a Stripe product ID where a price ID is expected, naming the variable", () => {
    expect(() => billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", ...stripeEnv, STRIPE_PRICE_STANDARD: "prod_x" })).toThrow(
      /STRIPE_PRICE_STANDARD/,
    );
  });

  it.each(["STRIPE_PRICE_PREMIUM", "STRIPE_PRICE_COACHING_SESSION", "STRIPE_PRICE_COACHING_SESSION_PREMIUM"])(
    "refuses a %s that is not a price ID",
    (variable) => {
      const env = {
        DATABASE_URL: "postgres://localhost/x",
        ...stripeEnv,
        STRIPE_PRICE_COACHING_SESSION: "price_session",
        STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_session_premium",
        [variable]: "prod_x",
      };
      expect(() => billingConfigFromEnv(env)).toThrow(new RegExp(`${variable}\\b`));
    },
  );

  it("takes the Coaching Session Prices, regular and Premium, when both are set", async () => {
    const config = billingConfigFromEnv({
      DATABASE_URL: "postgres://localhost/x",
      ...stripeEnv,
      STRIPE_PRICE_COACHING_SESSION: "price_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_session_premium",
    });

    expect(config.stripe?.coachingSessionPrices).toEqual({ regular: "price_session", premium: "price_session_premium" });
    await config.database.end();
  });

  it("refuses only one of the two Coaching Session Prices", () => {
    expect(() => billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", ...stripeEnv, STRIPE_PRICE_COACHING_SESSION: "price_session" })).toThrow(
      /STRIPE_PRICE_COACHING_SESSION_PREMIUM/,
    );
  });

  it("can point at another Stripe API origin, for the e2e suite", async () => {
    const config = billingConfigFromEnv({ DATABASE_URL: "postgres://localhost/x", ...stripeEnv, STRIPE_API_URL: "http://127.0.0.1:12111" });

    expect(config.stripe?.apiUrl).toBe("http://127.0.0.1:12111");
    await config.database.end();
  });
});
