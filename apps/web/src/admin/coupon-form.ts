/**
 * A Coupon as submitted by the Back Office's Coupon form, for `createCoupon`, which checks
 * every value: a percentage or an amount in euros (read as cents, with a comma or a dot), the
 * Plans ticked, the "first subscription only" box, and empty optional fields read as none.
 */
export function couponFromForm(form: FormData): {
  code: string;
  percentOff: number | null;
  amountOff: number | null;
  duration: string;
  durationInMonths: number | null;
  plans: string[];
  expiresAt: string | null;
  maxRedemptions: number | null;
  firstPaymentOnly: boolean;
} {
  const text = (field: string) => String(form.get(field) ?? "").trim();
  const number = (field: string) => (text(field) === "" ? null : Number(text(field).replace(",", ".")));
  const value = number("value");
  const kind = text("kind");
  return {
    code: text("code"),
    percentOff: kind === "percent" ? value : null,
    amountOff: kind === "amount" && value !== null ? Math.round(value * 100) : null,
    duration: text("duration"),
    durationInMonths: number("durationInMonths"),
    plans: form.getAll("plans").map(String),
    expiresAt: text("expiresAt") || null,
    maxRedemptions: number("maxRedemptions"),
    firstPaymentOnly: Boolean(form.get("firstPaymentOnly")),
  };
}
