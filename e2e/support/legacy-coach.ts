import { Pool } from "pg";
import { migrateCoachPages } from "../../apps/web/src/coach-pages";

/** Historical approved public page, solely in an E2E run's throwaway database. No legal approval is fabricated. */
export async function approvedLegacyCoach(coachId: string, databaseUrl = process.env.E2E_DATABASE_URL) {
  const database = new Pool({ connectionString: databaseUrl });
  try {
    await database.query("UPDATE human_coach SET public_ready=true WHERE id=$1", [coachId]);
    await migrateCoachPages(database);
  } finally {
    await database.end();
  }
}

/** A payment accepted before the new purchase gates, delivered as an old signed Stripe event. */
export async function paidHistoricalSession(page: import("@playwright/test").Page, coachId: string) {
  const { checkoutSessionEvent, signedEvent } = await import("../../apps/web/src/billing/fake-stripe");
  const person = (await (await page.request.get("/api/auth/get-session")).json()).user;
  const id = `cs_historical_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const payment = await fetch(`${process.env.E2E_STRIPE_URL}/__checkout_sessions/${id}/payment`, { method: "POST", body: new URLSearchParams({ amount: "9000" }) });
  const { payment_intent: paymentIntent } = await payment.json();
  const signed = signedEvent(checkoutSessionEvent("checkout.session.completed", { id, candidateId: person.id, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }));
  const response = await page.request.post("/api/billing/webhook", { data: signed.payload, headers: { "stripe-signature": signed.signature, "content-type": "application/json" } });
  if (response.status() !== 200) throw new Error(`Historical paid delivery: ${response.status()} ${await response.text()}`);
  return { checkoutId: id, candidateId: person.id as string, paymentIntent: paymentIntent as string, signed };
}
