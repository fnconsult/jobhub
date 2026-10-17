/**
 * What a Candidate is told when a Plan Quota refuses them: what they reached,
 * and which Plan would let them go on. Shared by pages (UpgradePrompt) and API
 * routes (quotaExceededResponse), so both say the same thing.
 */
import type { Plan } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { routes } from "../routes";
import type { PlanName, QuotaDecision } from "./index";

export type QuotaRefusal = Extract<QuotaDecision, { allowed: false }>;

/**
 * What an Upgrade Prompt is about: a refused quota, or the Job Digest a Plan
 * does not include (at all, or as often as `frequency`).
 */
export type PromptReason =
  | QuotaRefusal
  | { quota: "jobDigest"; plan: Plan; planName: PlanName; limit: 0; upgradeTo: Plan | null; upgradeToName: PlanName | null; frequency?: "daily" };

export interface UpgradePrompt {
  title: string;
  message: string;
  upgradeTo: Plan | null;
  /** Label of the link to the subscription page; null when no Plan offers more. */
  action: string | null;
  href: string;
}

export function upgradePrompt(refusal: PromptReason, locale: Locale): UpgradePrompt {
  const { t } = createI18n(locale);
  const { quota, limit, upgradeTo } = refusal;
  const plan = refusal.planName[locale];
  const upgradeName = refusal.upgradeToName?.[locale] ?? "";

  let message: string;
  if (quota === "jobDigest") {
    const daily = "frequency" in refusal && refusal.frequency === "daily";
    const reached = t(daily ? "billing.quotaReached.notIncluded.jobDigestDaily" : "billing.quotaReached.notIncluded.jobDigest", { plan });
    const next = daily ? "billing.quotaReached.upgradeIncludesDailyDigest" : "billing.quotaReached.upgradeIncludesIt";
    message = upgradeTo ? `${reached} ${t(next, { plan: upgradeName })}` : reached;
  } else {
    const reached =
      limit === 0
        ? t(`billing.quotaReached.notIncluded.${quota}`, { plan })
        : t(`billing.quotaReached.used.${quota}`, { plan, count: limit });
    const next = upgradeTo
      ? t(limit === 0 ? "billing.quotaReached.upgradeIncludes" : quota === "profiles" ? "billing.quotaReached.upgradeCreate" : "billing.quotaReached.upgradeUse", {
          plan: upgradeName,
        })
      : t(quota === "profiles" ? "billing.quotaReached.noMore" : "billing.quotaReached.renews");
    message = `${reached} ${next}`;
  }

  return {
    title: t("billing.quotaReached.title"),
    message,
    upgradeTo,
    action: upgradeTo ? t("billing.quotaReached.action", { plan: upgradeName }) : null,
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
