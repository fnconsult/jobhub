import type { JobOfferDetails } from "@jobhub/shared";
import type { TFunction } from "i18next";

type Glance = Pick<JobOfferDetails, "title" | "employer" | "location" | "contractType" | "salary">;

/** The Job Offer's salary range in words ("De 90 000 à 110 000 € brut par an"), or null when it gives none. */
export function jobOfferSalary({ salary }: Pick<JobOfferDetails, "salary">, t: TFunction, locale: string): string | null {
  const amount = (value: number) => new Intl.NumberFormat(locale).format(value);
  if (salary?.min !== undefined && salary.max !== undefined) return t("jobOffer.salaryRange", { min: amount(salary.min), max: amount(salary.max) });
  if (salary?.min !== undefined) return t("jobOffer.salaryFrom", { amount: amount(salary.min) });
  if (salary?.max !== undefined) return t("jobOffer.salaryUpTo", { amount: amount(salary.max) });
  return null;
}

/**
 * What a Job Offer says at a glance, in one line: employer, location, contract
 * type and salary, those it gives ("Groupe Ferlac · Lyon · CDI · De 95 000 à
 * 110 000 € brut par an"), or null when it gives none of them.
 */
export function jobOfferAtAGlance(jobOffer: Glance, t: TFunction, locale: string): string | null {
  const parts = [
    jobOffer.employer,
    jobOffer.location,
    jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : undefined,
    jobOfferSalary(jobOffer, t, locale),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
