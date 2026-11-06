import type { ProfileResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { AppText } from "../ui/AppText";

/**
 * A Profile's Search Criteria to read, one line each (#695): its Fiche and a Job Search's page (#692) show them so.
 * They change on the web: the page around them opens it.
 */
export function SearchCriteriaList({ criteria }: { criteria: ProfileResponse["searchCriteria"] }) {
  const { t, i18n } = useTranslation();
  const listed = (values: readonly string[]) => (values.length > 0 ? values.join(", ") : t("profile.notSpecified"));
  const criterion = (label: string, value: string) => <AppText>{t("mobile.profiles.criterion", { label, value })}</AppText>;
  const salary = criteria.minSalary === undefined ? t("profile.notSpecified") : t("profile.salary", { amount: new Intl.NumberFormat(i18n.language).format(criteria.minSalary) });
  return (
    <>
      {criterion(t("cvReview.targetRole"), criteria.targetRole || t("profile.notSpecified"))}
      {criterion(t("cvReview.locations"), listed(criteria.locations))}
      {criterion(t("mobile.profiles.contracts"), listed(criteria.contractTypes.map((type) => t(`cvReview.contractTypes.${type}`))))}
      {criterion(t("cvReview.remoteWork"), listed(criteria.remoteWorkOptions.map((option) => t(`cvReview.remoteWorkOptions.${option}`))))}
      {criterion(t("jobOffer.salary"), salary)}
      {criterion(t("mobile.profiles.sectors"), listed(criteria.sectors))}
    </>
  );
}
