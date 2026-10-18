import { FREE_PLAN, type Plan } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { couponTermsLabel } from "./coupon-label";
import type { Billing, PlanDefinition, PromotionCodeRefusal } from "./index";

export interface CodeNoticeInput {
  /** The Candidate's Plan: a code only applies to a new subscription, from Free. */
  plan: Plan;
  plans: PlanDefinition[];
  /** What `checkPromotionCode` said of the code (null: it could not tell). */
  promotion: Awaited<ReturnType<Billing["checkPromotionCode"]>>;
  /** Why Checkout refused the code for a Plan, when the Candidate is sent back from it. */
  refusal: { reason: PromotionCodeRefusal; plan: Plan } | null;
  locale: Locale;
}

/**
 * What the subscription page says of a code a Candidate brought (`?code=`): its terms and the offered
 * Plans it is for (`status`), or why it cannot be used (`alert`). Only the code as Stripe names it is
 * shown, never what was typed in the address bar.
 */
export function codeNotice({ plan, plans, promotion, refusal, locale }: CodeNoticeInput): { role: "status" | "alert"; text: string } {
  const { t } = createI18n(locale);
  const alert = (text: string) => ({ role: "alert" as const, text });
  if (refusal) {
    const name = plans.find((each) => each.key === refusal.plan)?.name[locale] ?? refusal.plan;
    return alert(t(`billing.page.codeRefused.${refusal.reason}`, { plan: name }));
  }
  if (plan !== FREE_PLAN) return alert(t("billing.page.codeElsewhere"));
  if (promotion === null) return alert(t("billing.page.codeUnchecked"));
  if (promotion.status === "throttled") return alert(t("billing.page.codeThrottled"));
  if (promotion.status === "invalid") return alert(t("billing.page.codeInvalid"));
  const { coupon } = promotion;
  const terms = couponTermsLabel(coupon, locale);
  if (coupon.plans === null) return { role: "status", text: t("billing.page.codeValidAll", { code: coupon.code, terms }) };
  const eligible = plans.filter((each) => each.status === "offered" && coupon.plans!.includes(each.key));
  if (eligible.length === 0) return alert(t("billing.page.codeNoPlan"));
  return { role: "status", text: t("billing.page.codeValid", { code: coupon.code, terms, plans: eligible.map((each) => each.name[locale]).join(", ") }) };
}
