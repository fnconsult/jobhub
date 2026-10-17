import { describe, expect, it } from "vitest";
import { activeDiscountLabel, couponTermsLabel } from "./coupon-label";

/** Intl puts (narrow) no-break spaces in amounts; compare them as plain spaces. */
const plain = (label: string) => label.replace(/\s/g, " ");

describe("Coupon labels", () => {
  it("reads a Coupon's terms in French", () => {
    expect(plain(couponTermsLabel({ discount: { percentOff: 50 }, duration: { months: 3 } }, "fr"))).toBe("−50 % pendant 3 mois");
    expect(plain(couponTermsLabel({ discount: { percentOff: 20 }, duration: { months: 1 } }, "fr"))).toBe("−20 % pendant 1 mois");
    expect(plain(couponTermsLabel({ discount: { amountOff: 500, currency: "eur" }, duration: "once" }, "fr"))).toBe("−5 € sur le premier paiement");
    expect(plain(couponTermsLabel({ discount: { amountOff: 250, currency: "eur" }, duration: "forever" }, "fr"))).toBe("−2,50 € tant que l'abonnement dure");
  });

  it("reads a Coupon's terms in English", () => {
    expect(couponTermsLabel({ discount: { percentOff: 50 }, duration: { months: 3 } }, "en")).toBe("50% off for 3 months");
    expect(couponTermsLabel({ discount: { percentOff: 50 }, duration: { months: 1 } }, "en")).toBe("50% off for 1 month");
    expect(couponTermsLabel({ discount: { amountOff: 500, currency: "eur" }, duration: "once" }, "en")).toBe("€5 off the first payment");
    expect(couponTermsLabel({ discount: { percentOff: 100 }, duration: "forever" }, "en")).toBe("100% off for as long as the subscription lasts");
  });

  it("tells the Candidate the discount their subscription is getting, and until when, in French time", () => {
    const endsAt = new Date("2027-01-14T23:30:00Z"); // 00:30 on 15 January in Paris

    expect(plain(activeDiscountLabel({ discount: { percentOff: 50 }, duration: { months: 3 }, endsAt }, "fr"))).toBe("Réduction en cours : −50 % jusqu'au 15 janvier 2027");
    expect(activeDiscountLabel({ discount: { percentOff: 50 }, duration: { months: 3 }, endsAt }, "en")).toBe("Current discount: 50% off until January 15, 2027");
    expect(plain(activeDiscountLabel({ discount: { amountOff: 300, currency: "eur" }, duration: "forever", endsAt: null }, "fr"))).toBe("Réduction en cours : −3 € tant que l'abonnement dure");
  });
});
