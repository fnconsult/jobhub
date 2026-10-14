import type { SearchCriteria } from "@jobhub/shared";
import type { TFunction } from "i18next";

/**
 * A Profile's Search Criteria in one line ("Lyon · CDI · 85 000 € brut par an
 * minimum · Télétravail : Hybride"), leaving out what the Candidate did not
 * specify. The target role is not repeated: the Job Search page names it.
 */
export function searchCriteriaInWords(criteria: SearchCriteria, t: TFunction, locale: string): string {
  const parts = [criteria.location.trim()];
  if (criteria.contractType) parts.push(t(`cvReview.contractTypes.${criteria.contractType}`));
  if (criteria.minSalary !== undefined) parts.push(t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) }));
  if (criteria.remoteWork) parts.push(t("jobSearch.remoteWork", { option: t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) }));
  return parts.filter(Boolean).join(" · ");
}
