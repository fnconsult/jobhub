import { describe, expect, it } from "vitest";
import { paymentFailedNotice } from "./payment-failed-notice";

describe("payment failed notice", () => {
  it("tells a Candidate whose subscription is past due that their last payment failed, and where to update their payment method", () => {
    expect(paymentFailedNotice("past_due", "fr", false)).toEqual({
      message:
        "Votre dernier paiement n'a pas abouti. Votre offre reste active pendant que notre prestataire de paiement, Stripe, réessaie : mettez à jour votre moyen de paiement pour la conserver.",
      action: "Mettre à jour mon moyen de paiement",
      portal: "/api/billing/portal",
    });
  });

  it("says it in English", () => {
    expect(paymentFailedNotice("past_due", "en", false)).toEqual({
      message:
        "Your last payment failed. Your Plan stays active while our payment provider, Stripe, tries again: update your payment method to keep it.",
      action: "Update my payment method",
      portal: "/api/billing/portal",
    });
  });

  it("says nothing once the subscription is paid again, or when there is none", () => {
    expect(paymentFailedNotice("active", "fr", false)).toBeNull();
    expect(paymentFailedNotice(null, "fr", false)).toBeNull();
    expect(paymentFailedNotice("active", "fr", true)).toBeNull();
  });

  it("inside the Jobbbox app's WebView, says the subscription is managed on jobbbox.ai, with no way to Stripe (#689)", () => {
    expect(paymentFailedNotice("past_due", "fr", true)).toEqual({
      message:
        "Votre dernier paiement n'a pas abouti. Votre offre reste active pendant que notre prestataire de paiement, Stripe, réessaie : mettez à jour votre moyen de paiement pour la conserver.",
      help: "Votre abonnement se gère sur jobbbox.ai, dans votre navigateur.",
    });
  });
});
