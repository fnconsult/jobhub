import { describe, expect, it } from "vitest";
import { couponFromForm } from "./coupon-form";

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

describe("the Coupon form of the Back Office", () => {
  it("reads a percentage off for some months, the Plans ticked, an expiry, a limit and the first subscription box", () => {
    expect(
      couponFromForm(
        form([
          ["code", " printemps50 "],
          ["kind", "percent"],
          ["value", "50"],
          ["duration", "repeating"],
          ["durationInMonths", "3"],
          ["plans", "standard"],
          ["plans", "premium"],
          ["expiresAt", "2027-03-31"],
          ["maxRedemptions", "100"],
          ["firstPaymentOnly", "on"],
        ]),
      ),
    ).toEqual({
      code: "printemps50",
      percentOff: 50,
      amountOff: null,
      duration: "repeating",
      durationInMonths: 3,
      plans: ["standard", "premium"],
      expiresAt: "2027-03-31",
      maxRedemptions: 100,
      firstPaymentOnly: true,
    });
  });

  it("reads an amount in euros, with a comma or a dot, as cents; empty fields as none", () => {
    expect(couponFromForm(form([["code", "BIENVENUE"], ["kind", "amount"], ["value", "5,50"], ["duration", "once"], ["durationInMonths", ""], ["expiresAt", ""], ["maxRedemptions", ""]]))).toEqual({
      code: "BIENVENUE",
      percentOff: null,
      amountOff: 550,
      duration: "once",
      durationInMonths: null,
      plans: [],
      expiresAt: null,
      maxRedemptions: null,
      firstPaymentOnly: false,
    });
    expect(couponFromForm(form([["kind", "amount"], ["value", "12.5"]])).amountOff).toBe(1250);
  });

  it("leaves a value that is no number for the billing module to refuse", () => {
    expect(couponFromForm(form([["kind", "percent"], ["value", "beaucoup"]])).percentOff).toBeNaN();
  });
});
