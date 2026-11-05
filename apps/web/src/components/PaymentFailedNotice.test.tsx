// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { paymentFailedNotice } from "@/billing/payment-failed-notice";
import { renderInFrench } from "@/design/testing";
import { PaymentFailedNotice } from "./PaymentFailedNotice";

describe("PaymentFailedNotice, the failed-payment Note", () => {
  it("on the web, leads to the Stripe customer portal to update the payment method", () => {
    const { container } = renderInFrench(<PaymentFailedNotice notice={paymentFailedNotice("past_due", "fr", false)!} />);

    expect(screen.getByText(/Votre dernier paiement n'a pas abouti/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mettre à jour mon moyen de paiement" })).toBeTruthy();
    expect(container.querySelector('form[action="/api/billing/portal"]')).not.toBeNull();
  });

  it("inside the Jobbbox app's WebView, says it with no way to Stripe: nothing is bought there (#689)", () => {
    const { container } = renderInFrench(<PaymentFailedNotice notice={paymentFailedNotice("past_due", "fr", true)!} />);

    expect(screen.getByText(/Votre dernier paiement n'a pas abouti/)).toBeTruthy();
    expect(screen.getByText("Votre abonnement se gère sur jobbbox.ai, dans votre navigateur.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[action*="/api/billing"], [href*="/api/billing"]')).toBeNull();
  });
});
