/**
 * What a Candidate is told when a Plan Quota refuses them: what they reached,
 * and which Plan would let them go on. Shared by pages (UpgradePrompt) and API
 * routes (quotaExceededResponse), so both say the same thing.
 */
import type { Plan } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { routes } from "../routes";
import type { QuotaDecision } from "./index";

export type QuotaRefusal = Extract<QuotaDecision, { allowed: false }>;

export interface UpgradePrompt {
  title: string;
  message: string;
  upgradeTo: Plan | null;
  /** Label of the link to the subscription page; null when no Plan offers more. */
  action: string | null;
  href: string;
}

export function upgradePrompt(refusal: QuotaRefusal, locale: Locale): UpgradePrompt {
  const { t } = createI18n(locale);
  const planName = (plan: Plan) => t(`billing.plans.${plan}`);
  const { quota, limit, upgradeTo } = refusal;
  const plan = planName(refusal.plan);

  const reached =
    limit === 0
      ? t(`billing.quotaReached.notIncluded.${quota}`, { plan })
      : t(`billing.quotaReached.used.${quota}`, { plan, count: limit });
  const next = upgradeTo
    ? t(limit === 0 ? "billing.quotaReached.upgradeIncludes" : quota === "profiles" ? "billing.quotaReached.upgradeCreate" : "billing.quotaReached.upgradeUse", {
        plan: planName(upgradeTo),
      })
    : t(quota === "profiles" ? "billing.quotaReached.noMore" : "billing.quotaReached.renews");

  return {
    title: t("billing.quotaReached.title"),
    message: `${reached} ${next}`,
    upgradeTo,
    action: upgradeTo ? t("billing.quotaReached.action", { plan: planName(upgradeTo) }) : null,
    href: routes.subscription,
  };
}

/** The answer of an API route the Candidate's Plan refuses: 402 Payment Required, with the prompt to show. */
export function quotaExceededResponse(refusal: QuotaRefusal, locale: Locale): Response {
  const { quota, plan, limit, upgradeTo } = refusal;
  return Response.json(
    { error: "quota_exceeded", quota, plan, limit, upgradeTo, prompt: upgradePrompt(refusal, locale) },
    { status: 402 },
  );
}
