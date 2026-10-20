"use client";

import { CONTRACT_TYPES, MAX_SEARCH_LOCATIONS, REMOTE_WORK_OPTIONS, type ContractType, type RemoteWork, type SearchCriteria } from "@jobhub/shared";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { TextField } from "./form-fields";

/** Search Criteria as a form holds them: what the inputs show. */
export interface CriteriaFields {
  targetRole: string;
  /** One input per place, at least one (left blank when none is known yet). */
  locations: string[];
  minSalary: string;
  contractTypes: ContractType[];
  remoteWorkOptions: RemoteWork[];
}

/** What the inputs show for saved (or drafted) Search Criteria. */
export function criteriaFieldsOf(criteria: Partial<SearchCriteria>): CriteriaFields {
  return {
    targetRole: criteria.targetRole ?? "",
    locations: criteria.locations?.length ? [...criteria.locations] : [""],
    minSalary: criteria.minSalary === undefined ? "" : String(criteria.minSalary),
    contractTypes: [...(criteria.contractTypes ?? [])],
    remoteWorkOptions: [...(criteria.remoteWorkOptions ?? [])],
  };
}

/**
 * The Search Criteria to send to the server: blank optional fields left out, a
 * salary typed with spaces or dots read as a whole number (anything else is sent
 * as typed, for the server to call invalid). Blank places are left for the
 * server to drop.
 */
export function searchCriteriaInput(criteria: CriteriaFields): Record<string, unknown> {
  const salary = criteria.minSalary.replace(/[\s.]/g, "");
  return {
    targetRole: criteria.targetRole,
    locations: criteria.locations,
    ...(salary ? { minSalary: /^\d+$/.test(salary) ? Number(salary) : salary } : {}),
    contractTypes: criteria.contractTypes,
    remoteWorkOptions: criteria.remoteWorkOptions,
  };
}

/** The labels of the Search Criteria fields named in `errors` (`searchCriteria.<field>`). */
export function useSearchCriteriaLabels(): Record<string, string> {
  const { t } = useTranslation();
  return {
    "searchCriteria.targetRole": t("cvReview.targetRole"),
    "searchCriteria.locations": t("cvReview.locations"),
    "searchCriteria.minSalary": t("cvReview.minSalary"),
    "searchCriteria.contractTypes": t("cvReview.contractType"),
    "searchCriteria.remoteWorkOptions": t("cvReview.remoteWork"),
  };
}

/** The error for `field` among `errors` named `searchCriteria.<field>` (or `searchCriteria.<field>.<index>`). */
function errorFor(errors: ProfileFieldError[], field: keyof CriteriaFields): ProfileFieldError | undefined {
  return errors.find((each) => each.field === `searchCriteria.${field}` || each.field.startsWith(`searchCriteria.${field}.`));
}

/** The Search Criteria inputs, each with the error to fix (from `errors`, fields named `searchCriteria.<field>`). */
export function SearchCriteriaFields(props: { value: CriteriaFields; onChange: (changes: Partial<CriteriaFields>) => void; errors: ProfileFieldError[] }) {
  const { t } = useTranslation();
  const { value, onChange, errors } = props;
  const error = {
    targetRole: errorFor(errors, "targetRole"),
    locations: errorFor(errors, "locations"),
    minSalary: errorFor(errors, "minSalary"),
    contractTypes: errorFor(errors, "contractTypes"),
    remoteWorkOptions: errorFor(errors, "remoteWorkOptions"),
  };
  return (
    <>
      <TextField
        label={t("cvReview.targetRole")}
        value={value.targetRole}
        onChange={(targetRole) => onChange({ targetRole })}
        error={error.targetRole}
        maxLength={PROFILE_NAME_MAX_LENGTH}
        required
      />
      <LocationFields value={value.locations} onChange={(locations) => onChange({ locations })} error={error.locations} />
      <TextField label={t("cvReview.minSalary")} value={value.minSalary} onChange={(minSalary) => onChange({ minSalary })} error={error.minSalary} numeric />
      <ContractTypeChoices value={value.contractTypes} onChange={(contractTypes) => onChange({ contractTypes })} error={error.contractTypes} />
      <RemoteWorkChoices value={value.remoteWorkOptions} onChange={(remoteWorkOptions) => onChange({ remoteWorkOptions })} error={error.remoteWorkOptions} />
    </>
  );
}

/** The message for a field error, as the review form words it. */
function ErrorMessage({ error, id }: { error: ProfileFieldError | undefined; id: string }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p id={id} className="field-error">
      {t(error.code === "required" ? "cvReview.required" : "cvReview.invalidValue")}
    </p>
  );
}

/**
 * The places to search, one text input each, up to MAX_SEARCH_LOCATIONS: "Ajouter un lieu"
 * adds an input (and moves the keyboard focus to it), each place after the first has its own
 * "Retirer" button. `onLeave` is told when the Candidate leaves an input (inline saving).
 */
export function LocationFields(props: {
  value: string[];
  onChange: (locations: string[]) => void;
  onLeave?: (locations: string[]) => void;
  /** Removing a place: by default the same as a change. */
  onRemove?: (locations: string[]) => void;
  error?: ProfileFieldError | undefined;
  /** Shown under each input, e.g. the inline "Lieu enregistré" flag. */
  notice?: (index: number) => ReactNode;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { value, onChange } = props;
  const container = useRef<HTMLFieldSetElement>(null);
  /** Where the keyboard focus goes after the next render: an input added, or the button after a removal. */
  const focusNext = useRef<number | "add" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    const target =
      next === "add"
        ? (container.current?.querySelector<HTMLElement>("[data-add-location]") ?? container.current?.querySelector<HTMLElement>(`[data-location="${value.length - 1}"]`))
        : container.current?.querySelector<HTMLElement>(`[data-location="${next}"]`);
    target?.focus();
  });
  const described = (index: number) => [`${id}-hint`, props.error && index === 0 ? `${id}-error` : ""].filter(Boolean).join(" ");
  const replace = (index: number, location: string) => value.map((each, at) => (at === index ? location : each));
  return (
    <fieldset className={props.inline ? "inline-fieldset" : "fieldset"} ref={container} aria-describedby={`${id}-hint`}>
      <legend className={props.inline ? "visually-hidden" : undefined}>{t("cvReview.locations")}</legend>
      <p id={`${id}-hint`} className="hint">
        {t("cvReview.locationsHint")}
      </p>
      {value.map((location, index) => (
        <div className="location-field" key={index}>
          <label htmlFor={`${id}-${index}`}>{t("cvReview.locationItem", { number: index + 1 })}</label>
          <div className="location-field-row">
            <input
              id={`${id}-${index}`}
              data-location={index}
              type="text"
              className={props.inline ? "inline-edit" : "input"}
              value={location}
              required={index === 0}
              aria-invalid={props.error && index === 0 ? true : undefined}
              aria-describedby={described(index)}
              onChange={(event) => onChange(replace(index, event.target.value))}
              onBlur={(event) => props.onLeave?.(replace(index, event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && props.inline) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            {index > 0 ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  focusNext.current = "add";
                  (props.onRemove ?? onChange)(value.filter((_, at) => at !== index));
                }}
              >
                {t("cvReview.removeLocation", { number: index + 1 })}
              </button>
            ) : null}
          </div>
          {props.notice?.(index)}
        </div>
      ))}
      <ErrorMessage error={props.error} id={`${id}-error`} />
      {value.length < MAX_SEARCH_LOCATIONS ? (
        <button
          type="button"
          className="button"
          data-add-location
          onClick={() => {
            focusNext.current = value.length;
            onChange([...value, ""]);
          }}
        >
          {t("cvReview.addLocation")}
        </button>
      ) : null}
    </fieldset>
  );
}

/** A group of checkboxes, any number of which may be ticked (none: no preference), in a fieldset with its legend. */
function Choices<T extends string>(props: {
  legend: string;
  options: readonly T[];
  label: (option: T) => string;
  value: readonly T[];
  onChange: (value: T[]) => void;
  error?: ProfileFieldError | undefined;
  disabled?: boolean;
  /** On a property list, whose row already names it: no frame, the legend for screen readers only. */
  inline?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const described = [`${id}-hint`, props.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <fieldset className={props.inline ? "inline-fieldset" : "fieldset"} aria-describedby={described}>
      <legend className={props.inline ? "visually-hidden" : undefined}>{props.legend}</legend>
      <p id={`${id}-hint`} className="hint">
        {t("cvReview.anyOfHint")}
      </p>
      {props.options.map((option) => (
        <div className="checkbox-field" key={option}>
          <input
            id={`${id}-${option}`}
            type="checkbox"
            checked={props.value.includes(option)}
            disabled={props.disabled}
            onChange={(event) =>
              props.onChange(props.options.filter((each) => (each === option ? event.target.checked : props.value.includes(each))))
            }
          />
          <label htmlFor={`${id}-${option}`}>{props.label(option)}</label>
        </div>
      ))}
      <ErrorMessage error={props.error} id={`${id}-error`} />
      {props.children}
    </fieldset>
  );
}

export type ChoicesProps<T> = {
  value: readonly T[];
  onChange: (value: T[]) => void;
  error?: ProfileFieldError | undefined;
  disabled?: boolean;
  inline?: boolean;
  children?: ReactNode;
};

/** The contract types wanted, as checkboxes. */
export function ContractTypeChoices(props: ChoicesProps<ContractType>) {
  const { t } = useTranslation();
  return <Choices legend={t("cvReview.contractType")} options={CONTRACT_TYPES} label={(option) => t(`cvReview.contractTypes.${option}`)} {...props} />;
}

/** The remote-work options wanted, as checkboxes. */
export function RemoteWorkChoices(props: ChoicesProps<RemoteWork>) {
  const { t } = useTranslation();
  return <Choices legend={t("cvReview.remoteWork")} options={REMOTE_WORK_OPTIONS} label={(option) => t(`cvReview.remoteWorkOptions.${option}`)} {...props} />;
}
