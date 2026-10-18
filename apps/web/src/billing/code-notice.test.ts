import { describe, expect, it } from "vitest";
import { codeNotice } from "./code-notice";
import type { Coupon, PlanDefinition } from "./index";

const plain = (text: string | undefined) => text?.replace(/\s/g, " ");
const plan = (key: string, fr: string, status: "offered" | "hidden" = "offered"): PlanDefinition => ({ key, name: { fr, en: fr }, rank: 1, status, stripeProductId: `prod_${key}`, features: [] });
const OFFERED = [plan("free", "Gratuite"), plan("standard", "Standard"), plan("premium", "Premium"), plan("annuel", "Annuel", "hidden")];
const coupon = (plans: string[] | null): Coupon => ({
  id: "promo_1",
  code: "PRINTEMPS50",
  discount: { percentOff: 50 },
  duration: { months: 3 },
  plans,
  expiresAt: null,
  maxRedemptions: null,
  firstPaymentOnly: false,
  timesRedeemed: 0,
  active: true,
});
const notice = (input: Partial<Parameters<typeof codeNotice>[0]>) => codeNotice({ plan: "free", plans: OFFERED, promotion: null, refusal: null, locale: "fr", ...input });

describe("what the subscription page says of a code a Candidate brought", () => {
  it("tells the terms of a valid code and the offered Plans it is for", () => {
    expect(notice({ promotion: { status: "valid", coupon: coupon(["standard", "annuel"]) } })).toMatchObject({ role: "status" });
    expect(plain(notice({ promotion: { status: "valid", coupon: coupon(["standard", "annuel"]) } })?.text)).toBe("Code PRINTEMPS50 : −50 % pendant 3 mois, valable sur Standard. Il s'appliquera au paiement.");
    expect(plain(notice({ promotion: { status: "valid", coupon: coupon(null) } })?.text)).toBe("Code PRINTEMPS50 : −50 % pendant 3 mois. Il s'appliquera au paiement.");
  });

  it("never says 'valid on' nothing: a code for no offered Plan is not available", () => {
    expect(notice({ promotion: { status: "valid", coupon: coupon(["annuel"]) } })).toEqual({ role: "alert", text: "Ce code promo ne s'applique à aucune des offres proposées. Vous pouvez tout de même choisir une offre, sans réduction." });
    expect(notice({ promotion: { status: "valid", coupon: coupon([]) } })?.role).toBe("alert");
  });

  it("says when a code is not valid, could not be checked, or too many were tried", () => {
    expect(notice({ promotion: { status: "invalid" } })?.text).toMatch(/^Ce code promo n'est pas valable/);
    expect(notice({ promotion: null })?.text).toMatch(/^Ce code promo n'a pas pu être vérifié/);
    expect(notice({ promotion: { status: "throttled" } })).toEqual({ role: "alert", text: "Vous avez essayé beaucoup de codes promo : réessayez dans quelques minutes. Vous pouvez tout de même choisir une offre, sans réduction." });
  });

  it("says why Checkout refused the code, naming the Plan, in the Candidate's language", () => {
    expect(notice({ refusal: { reason: "not_for_plan", plan: "premium" } })).toEqual({ role: "alert", text: "Ce code promo ne s'applique pas à l'offre Premium." });
    expect(notice({ refusal: { reason: "not_for_you", plan: "standard" } })?.text).toBe("Ce code promo ne peut pas vous être accordé : il est réservé à un premier paiement, et vous avez déjà payé (une séance de coaching compte), ou il vient d'être épuisé.");
    expect(notice({ refusal: { reason: "unchecked", plan: "standard" }, locale: "en" })?.text).toBe("This coupon code could not be checked just now.");
  });

  it("tells a Candidate already paying that a code is for a new subscription only", () => {
    expect(notice({ plan: "standard", promotion: { status: "valid", coupon: coupon(null) } })?.text).toMatch(/^Vous avez déjà une offre payante/);
  });
});
