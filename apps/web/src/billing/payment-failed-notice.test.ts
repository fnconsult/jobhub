import { describe, expect, it } from "vitest";
import { paymentFailedNotice } from "./payment-failed-notice";

describe("payment failed notice", () => {
  it("tells a Candidate whose subscription is past due that their last payment failed, and where to update their payment method", () => {
    expect(paymentFailedNotice("past_due", "fr")).toEqual({
      message:
        "Votre dernier paiement n'a pas abouti. Votre offre reste active pendant que notre prestataire de paiement, Stripe, réessaie : mettez à jour votre moyen de paiement pour la conserver.",
      action: "Mettre à jour mon moyen de paiement",
      portal: "/api/billing/portal",
    });
  });

  it("says it in English", () => {
    expect(paymentFailedNotice("past_due", "en")).toEqual({
      message:
        "Your last payment failed. Your Plan stays active while our payment provider, Stripe, tries again: update your payment method to keep it.",
      action: "Update my payment method",
      portal: "/api/billing/portal",
    });
  });

  it("says nothing once the subscription is paid again, or when there is none", () => {
    expect(paymentFailedNotice("active", "fr")).toBeNull();
    expect(paymentFailedNotice(null, "fr")).toBeNull();
  });
});
