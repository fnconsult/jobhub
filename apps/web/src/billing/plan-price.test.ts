import { describe, expect, it } from "vitest";
import { planPriceLabel } from "./plan-price";

/** Intl puts (narrow) no-break spaces in amounts; compare them as plain spaces. */
const plain = (label: string) => label.replace(/\s/g, " ");

describe("Plan price labels", () => {
  it("reads a monthly price in French", () => {
    expect(plain(planPriceLabel({ amount: 1900, currency: "eur", interval: "month" }, "fr"))).toBe("19 € / mois");
  });

  it("reads a monthly price in English", () => {
    expect(planPriceLabel({ amount: 1900, currency: "eur", interval: "month" }, "en")).toBe("€19 / month");
  });

  it("keeps the cents of a price that has some", () => {
    expect(plain(planPriceLabel({ amount: 1490, currency: "eur", interval: "month" }, "fr"))).toBe("14,90 € / mois");
  });

  it("prices the Free Plan at 0", () => {
    expect(plain(planPriceLabel({ amount: 0, currency: "eur", interval: "month" }, "fr"))).toBe("0 € / mois");
  });

  it("names a yearly interval", () => {
    expect(plain(planPriceLabel({ amount: 19000, currency: "eur", interval: "year" }, "fr"))).toBe("190 € / an");
    expect(planPriceLabel({ amount: 19000, currency: "usd", interval: "year" }, "en")).toBe("$190 / year");
  });
});
