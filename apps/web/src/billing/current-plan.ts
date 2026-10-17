import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { PlanName } from "./index";

/**
 * How the subscription page names the Candidate's Plan, in the Interface Language:
 * "Votre offre actuelle : Premium", or, once its cancellation is scheduled,
 * "Votre offre actuelle : Premium jusqu'au 15 novembre 2026" (the day in French time).
 */
export function currentPlanLabel({ planName, endsAt }: { planName: PlanName; endsAt: Date | null }, locale: Locale): string {
  const { t } = createI18n(locale);
  const name = planName[locale];
  if (!endsAt) return t("billing.page.currentPlan", { plan: name });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(endsAt);
  return t("billing.page.currentPlanUntil", { plan: name, date });
}
