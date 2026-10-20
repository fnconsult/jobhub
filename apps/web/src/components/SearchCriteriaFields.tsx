"use client";

import { CONTRACT_TYPES, MAX_SEARCH_LOCATIONS, REMOTE_WORK_OPTIONS, type ContractType, type RemoteWork, type SearchCriteria } from "@jobhub/shared";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { MIN_PLACE_QUERY_LENGTH, type PlaceSuggestion } from "@/places/geo-api";
import { TextField } from "./form-fields";
import { Icons } from "./icons";
import { addPlace, movedOption } from "./places-input";

/** Search Criteria as a form holds them: what the inputs show. */
export interface CriteriaFields {
  targetRole: string;
  /** The places, as chips: none when none is known yet. */
  locations: string[];
  minSalary: string;
  contractTypes: ContractType[];
  remoteWorkOptions: RemoteWork[];
}

/** What the inputs show for saved (or drafted) Search Criteria. */
export function criteriaFieldsOf(criteria: Partial<SearchCriteria>): CriteriaFields {
  return {
    targetRole: criteria.targetRole ?? "",
    locations: [...(criteria.locations ?? [])],
    minSalary: criteria.minSalary === undefined ? "" : String(criteria.minSalary),
    contractTypes: [...(criteria.contractTypes ?? [])],
    remoteWorkOptions: [...(criteria.remoteWorkOptions ?? [])],
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
      <LocationsInput value={value.locations} onChange={(locations) => onChange({ locations })} error={error.locations} />
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

/** Suggestions already fetched in this page, by query: typing back over a query asks nothing again. */
const suggested = new Map<string, PlaceSuggestion[]>();

/** The places `/api/places` suggests for `query`; none when it cannot answer. */
async function suggestPlaces(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const kept = suggested.get(query);
  if (kept) return kept;
  const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal });
  const body = response.ok ? await response.json().catch(() => null) : null;
  const places: PlaceSuggestion[] = Array.isArray(body?.places) ? body.places : [];
  if (response.ok) suggested.set(query, places);
  return places;
}

/** How long typing pauses before suggestions are asked for. */
const SUGGEST_DELAY_MS = 250;

/**
 * The places to search (#235), up to MAX_SEARCH_LOCATIONS: chips on one line, each with its
 * "Retirer" button, then one input (an ARIA 1.2 combobox) that suggests communes, départements and
 * régions from 3 characters. Choosing a suggestion, or Enter on a place typed as it is, adds a chip;
 * a place already there is refused with a message. The input goes at MAX_SEARCH_LOCATIONS places.
 * The keyboard focus stays on the input after a chip is added or removed. `onChange` gets each new
 * list of places. `keepOne`: the last place has no "Retirer" (saved at once, Locations is required).
 */
export function LocationsInput(props: {
  value: string[];
  onChange: (locations: string[]) => void;
  error?: ProfileFieldError | undefined;
  /** On a property list, whose row already names it: no frame, the legend for screen readers only. */
  inline?: boolean;
  keepOne?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { value, onChange } = props;
  const [query, setQuery] = useState("");
  /** The suggestions for `query` (the trimmed text they were asked for); none asked for yet: null. */
  const [suggestions, setSuggestions] = useState<{ query: string; places: PlaceSuggestion[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLFieldSetElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  /** Where the keyboard focus goes after the next render, once a chip is added or removed. */
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const chips = container.current?.querySelectorAll<HTMLElement>("[data-remove-place]");
    (input.current ?? chips?.[chips.length - 1])?.focus();
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  const full = value.length >= MAX_SEARCH_LOCATIONS;
  const typed = query.trim();
  const answered = suggestions !== null && suggestions.query === typed ? suggestions.places : null;
  const expanded = open && !!answered && answered.length > 0;
  const message = refusal ?? (answered && answered.length === 0 ? t("cvReview.noPlaceFound", { place: typed }) : null);

  function search(text: string) {
    clearTimeout(timer.current);
    request.current?.abort();
    const wanted = text.trim();
    if (wanted.length < MIN_PLACE_QUERY_LENGTH) return;
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      request.current = controller;
      suggestPlaces(wanted, controller.signal)
        .catch(() => [])
        .then((places) => {
          if (controller.signal.aborted) return;
          setSuggestions({ query: wanted, places });
          setActive(null);
          setOpen(true);
        });
    }, SUGGEST_DELAY_MS);
  }

  function add(place: string) {
    const result = addPlace(value, place);
    if ("refused" in result) {
      if (result.refused === "duplicate") setRefusal(t("cvReview.placeAlreadyListed", { place: place.trim() }));
      setOpen(false);
      return;
    }
    clearTimeout(timer.current);
    request.current?.abort();
    setQuery("");
    setSuggestions(null);
    setOpen(false);
    setActive(null);
    setRefusal(null);
    refocus.current = true;
    onChange(result.places);
  }

  function remove(index: number) {
    setRefusal(null);
    refocus.current = true;
    onChange(value.filter((_, at) => at !== index));
  }

  const optionId = (index: number) => `${id}-option-${index}`;
  const described = [`${id}-hint`, `${id}-input-hint`, message ? `${id}-message` : "", props.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <fieldset className={props.inline ? "inline-fieldset" : "fieldset"} ref={container} aria-describedby={`${id}-hint`}>
      <legend className={props.inline ? "visually-hidden" : undefined}>{t("cvReview.locations")}</legend>
      <p id={`${id}-hint`} className="hint">
        {t("cvReview.locationsHint")}
      </p>
      <div className="places-field">
        <ul className="place-chips" role="list">
          {value.map((place, index) => (
            <li className="place-chip" key={`${index}-${place}`}>
              <span>{place}</span>
              {props.keepOne && value.length === 1 ? null : (
                <button type="button" className="place-chip-remove" data-remove-place aria-label={t("cvReview.removeLocation", { place })} onClick={() => remove(index)}>
                  <Icons.close />
                  {t("cvReview.removePlace")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {full ? null : (
          <div className="place-combobox">
            <label htmlFor={`${id}-input`} className="visually-hidden">
              {t("cvReview.placeInput")}
            </label>
            <input
              id={`${id}-input`}
              ref={input}
              type="text"
              role="combobox"
              autoComplete="off"
              className={props.inline ? "inline-edit" : "input"}
              value={query}
              aria-expanded={expanded}
              aria-controls={`${id}-listbox`}
              aria-autocomplete="list"
              aria-activedescendant={expanded && active !== null ? optionId(active) : undefined}
              aria-invalid={props.error ? true : undefined}
              aria-describedby={described}
              onChange={(event) => {
                setQuery(event.target.value);
                setRefusal(null);
                setActive(null);
                search(event.target.value);
              }}
              onBlur={() => {
                setOpen(false);
                setActive(null);
              }}
              onKeyDown={(event) => {
                const places = answered ?? [];
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  if (places.length === 0) return;
                  event.preventDefault();
                  setOpen(true);
                  setActive(movedOption(expanded ? active : null, places.length, event.key === "ArrowDown" ? "down" : "up"));
                } else if (event.key === "Enter") {
                  // Never the form's submit while a place is typed.
                  if (!typed) return;
                  event.preventDefault();
                  add(expanded && active !== null ? places[active]!.name : query);
                } else if (event.key === "Escape") {
                  if (expanded) {
                    event.preventDefault();
                    setOpen(false);
                    setActive(null);
                  } else if (query) {
                    event.preventDefault();
                    setQuery("");
                    setRefusal(null);
                    search("");
                  }
                }
              }}
            />
            <ul id={`${id}-listbox`} role="listbox" className="place-options" aria-label={t("cvReview.locations")} hidden={!expanded}>
              {(expanded ? answered : []).map((place, index) => (
                <li
                  key={`${place.kind}-${place.name}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className="place-option"
                  // The focus stays on the input.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(place.name)}
                >
                  <span>{place.name}</span>
                  <span className="place-option-kind">{t(`cvReview.placeKinds.${place.kind}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p id={`${id}-input-hint`} className="hint">
        {full ? t("cvReview.placesFull", { max: MAX_SEARCH_LOCATIONS }) : t("cvReview.placeInputHint")}
      </p>
      <p id={`${id}-message`} className="hint" role="status">
        {message}
      </p>
      <ErrorMessage error={props.error} id={`${id}-error`} />
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
