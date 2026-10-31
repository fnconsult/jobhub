import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";
import { longDay, reductionLines } from "./describe";
import type { ReducedQuotas } from "./reduction";
import type { PlanFeature } from "@jobhub/shared";

/**
 * The notice of a Quota Reduction (#514, L224-25-26), on a durable medium: what changes (one card each, now and from the
 * effective date), why, when, and the subscriber's right to cancel without fees, refunded prorata, until `resolvableUntil`.
 * The button leads to that cancellation.
 */
export function quotaReductionEmail(
  notice: {
    planName: string;
    quotas: ReducedQuotas;
    removedFeatures: readonly PlanFeature[];
    reason: string;
    effectiveOn: string;
    resolvableUntil: string;
    resolveUrl: string;
  },
  language: Locale,
): RenderedEmail {
  const { t } = createI18n(language);
  const date = longDay(notice.effectiveOn, language);
  const until = longDay(notice.resolvableUntil, language);
  const cards = reductionLines(notice, language).map((line) => ({
    card: { title: line.label, details: [t("quotaReduction.before", { value: line.before }), t("quotaReduction.after", { date, value: line.after })] },
  }));
  return renderEmail({
    language,
    subject: t("quotaReduction.email.subject", { plan: notice.planName, date }),
    title: t("quotaReduction.email.title", { plan: notice.planName }),
    body: [
      t("quotaReduction.email.intro", { plan: notice.planName, date }),
      ...cards,
      t("quotaReduction.email.reason", { reason: notice.reason }),
      t("quotaReduction.email.right", { date, until }),
      { action: { label: t("quotaReduction.resolve"), url: notice.resolveUrl } },
      t("quotaReduction.email.nothingToDo"),
    ],
    footer: { reason: t("quotaReduction.email.footer", { plan: notice.planName }) },
  });
}
