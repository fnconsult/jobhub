import { describe, expect, it } from "vitest";
import { commissionAmount, proportionalAmount, earningLine, monthlyEarnings, scheduledPayoutAt, type Earning } from "./earnings";
const sale = (change: Partial<Earning> = {}): Earning => ({
  id: "session",
  paidAt: new Date("2026-04-17T22:30:00Z"),
  amount: 10000,
  commission: 2000,
  refunded: 0,
  refundedCommission: 0,
  processingFees: 0,
  allocated: 0,
  ...change,
});
describe("monthly Connect earnings", () => {
  it("waits through May Day and its weekend before considering a payment payable", () => {
    const line = earningLine(sale());
    expect(line.withdrawalClosesAt.toISOString()).toBe("2026-05-04T22:00:00.000Z");
    expect(line.payoutAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
    expect(monthlyEarnings([sale()], new Date("2026-05-01T12:00Z")).payout).toBe(0);
    expect(monthlyEarnings([sale()], new Date("2026-06-01T12:00Z")).payout).toBe(8000);
  });
  it("uses the original commission, real commission refunds and processing fees", () => {
    expect(commissionAmount(9999, 1750)).toBe(1750);
    expect(proportionalAmount(99999999, 49999999, 99999999)).toBe(49999999);
    expect(earningLine(sale({ amount: 9999, commission: 1750, refunded: 3000, refundedCommission: 525, processingFees: 175 })).net).toBe(5599);
  });
  it("deducts a refund before payout and carries a refund after payout into the following proceeds", () => {
    const at = new Date("2026-07-01T12:00Z");
    expect(monthlyEarnings([sale({ refunded: 10000, refundedCommission: 2000 })], at).payout).toBe(0);
    const refunded = sale({ id: "refunded", refunded: 10000, refundedCommission: 2000, allocated: 8000 });
    expect(monthlyEarnings([refunded], at)).toMatchObject({ payout: 0, carry: -8000 });
    expect(monthlyEarnings([refunded, sale({ id: "next", amount: 15000, commission: 3000 })], at)).toMatchObject({ payout: 4000, carry: 0 });
  });
  it("does not repeat an allocated amount and handles both French DST offsets", () => {
    expect(monthlyEarnings([sale({ allocated: 8000 })], new Date("2026-07-01T12:00Z")).payout).toBe(0);
    expect(scheduledPayoutAt(new Date("2026-10-01T00:30Z")).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(scheduledPayoutAt(new Date("2026-01-01T00:30Z")).toISOString()).toBe("2026-02-01T12:00:00.000Z");
  });
  it("refuses unsafe or impossible monetary values", () => {
    expect(() => commissionAmount(1, -1)).toThrow();
    expect(() => earningLine(sale({ refunded: 10001 }))).toThrow();
    expect(() => earningLine(sale({ allocated: NaN }))).toThrow();
  });
});
