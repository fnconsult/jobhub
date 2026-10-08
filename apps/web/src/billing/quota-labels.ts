import { MONTHLY_QUOTAS, type MonthlyQuota, type PlanQuotas } from "@jobhub/shared";
import type { TFunction } from "i18next";

/** How one Plan Quota reads in a table: "3 par mois", "Illimité", "Non compris", "Chaque semaine". */
export function planQuotaValue(t: TFunction, quota: keyof PlanQuotas, quotas: PlanQuotas): string {
  if (quota === "jobDigest") return t(`billing.jobDigest.${quotas.jobDigest}`);
  const limit = quotas[quota];
  if (limit === null) return t("billing.page.unlimited");
  if (limit === 0) return t("billing.page.notIncluded");
  return MONTHLY_QUOTAS.includes(quota as MonthlyQuota) ? t("billing.page.perMonth", { count: limit }) : String(limit);
}
