import type { Locale } from "@jobhub/shared/i18n";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { Note } from "@/design/Note";
import type { OpenReduction } from "@/quota-reductions";
import { longDay, reductionLines } from "@/quota-reductions/describe";

/**
 * A Quota Reduction the Candidate may cancel over (#514), as the e-mail told them: what goes down and from when, why,
 * and their right to cancel at no cost, refunded prorata. `children`: the way to do it.
 */
export function QuotaReductionNotice({ reduction, locale, t, children }: { reduction: OpenReduction; locale: Locale; t: TFunction; children?: ReactNode }) {
  const date = longDay(reduction.effectiveOn, locale);
  return (
    <Note tone="warn" title={t("quotaReduction.page.title", { plan: reduction.planName[locale], date })}>
      <p>{t("quotaReduction.page.intro", { date })}</p>
      <ul>
        {reductionLines(reduction, locale).map((line) => (
          <li key={line.label}>{t("quotaReduction.change", { label: line.label, before: line.before, after: line.after })}</li>
        ))}
      </ul>
      <p>{t("quotaReduction.page.reason", { reason: reduction.reason })}</p>
      <p>{t("quotaReduction.page.right", { until: longDay(reduction.resolvableUntil, locale) })}</p>
      {children}
    </Note>
  );
}
