/**
 * Runs once when the server starts, before it serves a request (Next.js
 * instrumentation): reads the Provider Secrets and the Sign-in Providers a first
 * time and starts listening for their changes, so the first request already uses
 * the keys and sign-in configured in the Back Office rather than env's (ADR-0020, #209).
 * Then ties the paid Plans still without a Stripe product to the products of their env
 * Prices (#206); billing tries again when it first needs one if Stripe cannot be reached now.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startProviderSecrets } = await import("@/provider-secrets/server");
  await startProviderSecrets();
  const { startSignInProviders } = await import("@/sign-in-providers/server");
  await startSignInProviders();
  try {
    const { getBilling } = await import("@/billing/server");
    await getBilling().linkPlansToEnvPrices();
  } catch (error) {
    console.error("[billing] could not tie the Plans to their Stripe products at startup; retried on first use", error);
  }
}
