import { describe, expect, it } from "vitest";
import { withdrawalRefund } from "./prorata";

const paris = (wallClock: string) => new Date(`${wallClock}:00${wallClock < "2026-10-25T03:00" ? "+02:00" : "+01:00"}`);
/** 19 € paid for the month from 12 October to 12 November: 31 days. */
const october = { amount: 1900, period: { start: paris("2026-10-12T10:00"), end: paris("2026-11-12T10:00") } };

describe("what a Withdrawal refunds of a Plan's payment (C. conso. L221-25, #512)", () => {
  it("is the amount paid less the share of the days elapsed since the start of the period, with the Immediate Performance Request", () => {
    // 3 days of 31: 1,84 € kept for the service already provided.
    expect(withdrawalRefund(october, paris("2026-10-15T10:00"), true)).toBe(1716);
  });

  it("counts whole days elapsed: the day begun is not yet provided", () => {
    expect(withdrawalRefund(october, paris("2026-10-12T18:00"), true)).toBe(1900);
    expect(withdrawalRefund(october, paris("2026-10-15T09:59"), true)).toBe(1900 - Math.round((1900 * 2) / 31));
  });

  it("is the whole amount without the Immediate Performance Request", () => {
    expect(withdrawalRefund(october, paris("2026-10-20T10:00"), false)).toBe(1900);
  });

  it("is the whole amount when Stripe did not tell the period the payment was for", () => {
    expect(withdrawalRefund({ amount: 1900 }, paris("2026-10-20T10:00"), true)).toBe(1900);
  });

  it("is nothing for a period wholly provided, and the whole for one not started", () => {
    expect(withdrawalRefund(october, paris("2026-11-20T10:00"), true)).toBe(0);
    expect(withdrawalRefund(october, paris("2026-10-01T10:00"), true)).toBe(1900);
  });
});
