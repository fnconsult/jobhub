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

/**
 * How the Sidebar's foot names the Candidate's Plan (#923), in the Interface Language: its name, « Premium », and once
 * its cancellation is scheduled, apart, until when it is kept, « jusqu'au 30 nov. » (the day in French time).
 */
export function sidebarPlanLabel({ planName, endsAt }: { planName: PlanName; endsAt: Date | null }, locale: Locale): { plan: string; until: string | null } {
  const plan = planName[locale];
  if (!endsAt) return { plan, until: null };
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(endsAt);
  return { plan, until: createI18n(locale).t("billing.page.planUntil", { date }) };
}
