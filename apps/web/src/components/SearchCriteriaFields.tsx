"use client";

import { CONTRACT_TYPES, REMOTE_WORK_OPTIONS, type SearchCriteria } from "@jobhub/shared";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { SelectField, TextField } from "./form-fields";

/** Search Criteria as a form holds them: what the inputs show. */
export interface CriteriaFields {
  targetRole: string;
  location: string;
  minSalary: string;
  contractType: string;
  remoteWork: string;
}

/** What the inputs show for saved (or drafted) Search Criteria. */
export function criteriaFieldsOf(criteria: Partial<SearchCriteria>): CriteriaFields {
  return {
    targetRole: criteria.targetRole ?? "",
    location: criteria.location ?? "",
    minSalary: criteria.minSalary === undefined ? "" : String(criteria.minSalary),
    contractType: criteria.contractType ?? "",
    remoteWork: criteria.remoteWork ?? "",
  };
}

/**
 * The Search Criteria to send to the server: blank optional fields left out, a
 * salary typed with spaces or dots read as a whole number (anything else is sent
 * as typed, for the server to call invalid).
 */
export function searchCriteriaInput(criteria: CriteriaFields): Record<string, unknown> {
  const salary = criteria.minSalary.replace(/[\s.]/g, "");
  return {
    targetRole: criteria.targetRole,
    location: criteria.location,
    ...(salary ? { minSalary: /^\d+$/.test(salary) ? Number(salary) : salary } : {}),
    ...(criteria.contractType ? { contractType: criteria.contractType } : {}),
    ...(criteria.remoteWork ? { remoteWork: criteria.remoteWork } : {}),
  };
}

/** The labels of the Search Criteria fields named in `errors` (`searchCriteria.<field>`). */
export function useSearchCriteriaLabels(): Record<string, string> {
  const { t } = useTranslation();
  return {
    "searchCriteria.targetRole": t("cvReview.targetRole"),
    "searchCriteria.location": t("cvReview.location"),
    "searchCriteria.minSalary": t("cvReview.minSalary"),
    "searchCriteria.contractType": t("cvReview.contractType"),
    "searchCriteria.remoteWork": t("cvReview.remoteWork"),
  };
}

/** The Search Criteria inputs, each with the error to fix (from `errors`, fields named `searchCriteria.<field>`). */
export function SearchCriteriaFields(props: { value: CriteriaFields; onChange: (changes: Partial<CriteriaFields>) => void; errors: ProfileFieldError[] }) {
  const { t } = useTranslation();
  const { value, onChange } = props;
  const error = Object.fromEntries(
    props.errors.flatMap((each) => (each.field.startsWith("searchCriteria.") ? [[each.field.slice("searchCriteria.".length), each]] : [])),
  ) as Partial<Record<keyof CriteriaFields, ProfileFieldError>>;
  return (
    <>
      <TextField label={t("cvReview.targetRole")} value={value.targetRole} onChange={(targetRole) => onChange({ targetRole })} error={error.targetRole} maxLength={PROFILE_NAME_MAX_LENGTH} required />
      <TextField label={t("cvReview.location")} value={value.location} onChange={(location) => onChange({ location })} error={error.location} required />
      <TextField label={t("cvReview.minSalary")} value={value.minSalary} onChange={(minSalary) => onChange({ minSalary })} error={error.minSalary} numeric />
      <SelectField
        label={t("cvReview.contractType")}
        value={value.contractType}
        onChange={(contractType) => onChange({ contractType })}
        options={CONTRACT_TYPES.map((option) => [option, t(`cvReview.contractTypes.${option}`)])}
        error={error.contractType}
      />
      <SelectField
        label={t("cvReview.remoteWork")}
        value={value.remoteWork}
        onChange={(remoteWork) => onChange({ remoteWork })}
        options={REMOTE_WORK_OPTIONS.map((option) => [option, t(`cvReview.remoteWorkOptions.${option}`)])}
        error={error.remoteWork}
      />
    </>
  );
}
