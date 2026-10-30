import { WEEKLY_QUOTAS, type JobDigestFrequency, type PlanFeature, type PlanQuotas, type WeeklyQuota } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { ReducedQuotas } from "./reduction";

/** One change a Quota Reduction makes, in words: what it is about, what it gives now, what it gives from its effective date. */
export interface ReductionLine {
  label: string;
  before: string;
  after: string;
}

/** A quota's amount in words: « Illimité », « 7 par semaine », « Chaque semaine », « 3 ». */
function amount(quota: keyof PlanQuotas, value: unknown, t: ReturnType<typeof createI18n>["t"]): string {
  if (value === null) return t("billing.page.unlimited");
  if (quota === "jobDigest") return t(`billing.jobDigest.${value as JobDigestFrequency}`);
  if (WEEKLY_QUOTAS.includes(quota as WeeklyQuota)) return t("billing.page.perWeek", { count: Number(value) });
  return String(value);
}

/** What a Quota Reduction lowers, one line per quota and per Plan Feature taken off, in `language`. */
export function reductionLines({ quotas, removedFeatures }: { quotas: ReducedQuotas; removedFeatures: readonly PlanFeature[] }, language: Locale): ReductionLine[] {
  const { t } = createI18n(language);
  return [
    ...(Object.entries(quotas) as [keyof PlanQuotas, { before: unknown; after: unknown }][]).map(([quota, step]) => ({
      label: t(`billing.quotas.${quota}`),
      before: amount(quota, step.before, t),
      after: amount(quota, step.after, t),
    })),
    ...removedFeatures.map((feature) => ({ label: t(`quotaReduction.features.${feature}`), before: t("quotaReduction.included"), after: t("billing.page.notIncluded") })),
  ];
}

/** « 14 novembre 2026 »: a day ("2026-11-14") as the Candidate reads it. */
export function longDay(day: string, language: Locale): string {
  return new Intl.DateTimeFormat(createI18n(language).language, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
