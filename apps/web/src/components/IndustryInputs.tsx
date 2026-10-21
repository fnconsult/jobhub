"use client";

import { NO_INDUSTRY_REFERENCE, type IndustryReference } from "@jobhub/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { Icons } from "./icons";
import { industryOptions, matchingOptions, withSectors, type IndustryField, type IndustryOption } from "./industry-choices";
import { movedOption } from "./places-input";

/** The Sectors, Subsectors and Domains of Search Criteria, as codes. */
export interface IndustryValue {
  sectors: string[];
  subsectors: string[];
  domains: string[];
}

/** The labels, asked of `/api/reference-data` once per page; asked again after a failure. */
let reading: Promise<IndustryReference> | null = null;

function readReference(): Promise<IndustryReference> {
  reading ??= fetch("/api/reference-data")
    .then(async (response) => {
      if (!response.ok) throw new Error(`reference data answered ${response.status}`);
      return (await response.json()) as IndustryReference;
    })
    .catch(() => {
      reading = null;
      return NO_INDUSTRY_REFERENCE;
    });
  return reading;
}

/** The NAF and ROME-domain labels (#236) the inputs offer: none until they have come. */
export function useIndustryReference(): IndustryReference {
  const [reference, setReference] = useState<IndustryReference>(NO_INDUSTRY_REFERENCE);
  useEffect(() => {
    let current = true;
    void readReference().then((read) => {
      if (current) setReference(read);
    });
    return () => {
      current = false;
    };
  }, []);
  return reference;
}

/** The labels of the Sectors, Subsectors and Domains inputs, as field errors name them. */
export function useIndustryLabels(): Record<IndustryField, string> {
  const { t } = useTranslation();
  return { sectors: t("cvReview.sectors"), subsectors: t("cvReview.subsectors"), domains: t("cvReview.domains") };
}

/**
 * One of the Sectors, Subsectors or Domains inputs, `field`, with the choices `value` holds and the Sectors
 * chosen (`sectors`, which limit the Subsectors offered). `onChange` gets the new choices of all three: a
 * Sector removed takes its Subsectors with it.
 */
export function IndustryInput(props: {
  field: IndustryField;
  value: IndustryValue;
  reference: IndustryReference;
  onChange: (value: IndustryValue) => void;
  error?: ProfileFieldError | undefined;
  /** On a property list, whose row already names it: no frame, the legend for screen readers only. */
  inline?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { field, value, reference } = props;
  const options = industryOptions(reference, field, value.sectors, i18n.language);
  const labels = useIndustryLabels();
  const hint =
    field === "subsectors" && value.sectors.length === 0 ? t("cvReview.subsectorsNeedSector") : t(`cvReview.${field === "sectors" ? "sectorsHint" : field === "subsectors" ? "subsectorsHint" : "domainsHint"}`);
  const change = (codes: string[]) =>
    props.onChange(field === "sectors" ? { ...value, ...withSectors(value, codes) } : { ...value, [field]: codes });
  return (
    <ChipsCombobox
      legend={labels[field]}
      hint={hint}
      inputLabel={t(`cvReview.industryInputs.${field}`)}
      options={options}
      // A code the reference data does not name yet is shown as it is.
      chosen={value[field].map((code) => options.find((option) => option.code === code) ?? { code, label: code })}
      onChange={change}
      error={props.error}
      inline={props.inline}
      disabled={props.disabled || options.length === 0}
    />
  );
}

/**
 * A multi-select combobox with chips (ARIA 1.2): the choices as chips, each with its "Retirer" button,
 * then an input whose list opens on a click, a down arrow or typing, filtered by label as it is typed;
 * arrows move through it, Enter or a click chooses one, Escape closes the list then empties the input.
 * The focus stays on the input.
 */
function ChipsCombobox(props: {
  legend: string;
  hint: string;
  inputLabel: string;
  options: IndustryOption[];
  chosen: IndustryOption[];
  onChange: (codes: string[]) => void;
  error?: ProfileFieldError | undefined;
  inline?: boolean | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLFieldSetElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    input.current?.focus();
  });

  useEffect(() => {
    if (active !== null) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);

  const codes = props.chosen.map((option) => option.code);
  const matching = matchingOptions(props.options, codes, query);
  const expanded = open && matching.length > 0;
  const message = open && query.trim() && matching.length === 0 ? t("cvReview.noIndustryFound", { query: query.trim() }) : null;

  function choose(option: IndustryOption) {
    setQuery("");
    setActive(null);
    refocus.current = true;
    props.onChange([...codes, option.code]);
  }

  function remove(code: string) {
    refocus.current = true;
    props.onChange(codes.filter((each) => each !== code));
  }

  const optionId = (index: number) => `${id}-option-${index}`;
  const described = [`${id}-hint`, `${id}-input-hint`, message ? `${id}-message` : "", props.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <fieldset className={props.inline ? "inline-fieldset" : "fieldset"} ref={container} aria-describedby={`${id}-hint`}>
      <legend className={props.inline ? "visually-hidden" : undefined}>{props.legend}</legend>
      <p id={`${id}-hint`} className="hint">
        {props.hint}
      </p>
      <div className="places-field">
        <ul className="place-chips" role="list">
          {props.chosen.map((option) => (
            <li className="place-chip" key={option.code}>
              <span>{option.label}</span>
              <button type="button" className="place-chip-remove" aria-label={t("cvReview.removeChoice", { label: option.label })} onClick={() => remove(option.code)}>
                <Icons.close />
                {t("cvReview.removePlace")}
              </button>
            </li>
          ))}
        </ul>
        <div className="place-combobox">
          <label htmlFor={`${id}-input`} className="visually-hidden">
            {props.inputLabel}
          </label>
          <input
            id={`${id}-input`}
            ref={input}
            type="text"
            role="combobox"
            autoComplete="off"
            className={props.inline ? "inline-edit" : "input"}
            value={query}
            disabled={props.disabled}
            aria-expanded={expanded}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active !== null ? optionId(active) : undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={described}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(null);
              setOpen(true);
            }}
            onBlur={() => {
              setOpen(false);
              setActive(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (matching.length === 0) return;
                event.preventDefault();
                setOpen(true);
                setActive(movedOption(expanded ? active : null, matching.length, event.key === "ArrowDown" ? "down" : "up"));
              } else if (event.key === "Enter") {
                // Never the form's submit while the list is open or something is typed.
                if (!expanded && !query.trim()) return;
                event.preventDefault();
                const option = expanded ? (active !== null ? matching[active] : matching.length === 1 ? matching[0] : undefined) : undefined;
                if (option) choose(option);
              } else if (event.key === "Escape") {
                if (expanded) {
                  event.preventDefault();
                  setOpen(false);
                  setActive(null);
                } else if (query) {
                  event.preventDefault();
                  setQuery("");
                }
              }
            }}
          />
          <ul id={`${id}-listbox`} role="listbox" className="place-options place-options-scroll" aria-label={props.legend} hidden={!expanded}>
            {(expanded ? matching : []).map((option, index) => (
              <li
                key={option.code}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="place-option"
                // The focus stays on the input.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.group ? <span className="place-option-kind">{option.group}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p id={`${id}-input-hint`} className="hint">
        {t("cvReview.industryInputHint")}
      </p>
      <p id={`${id}-message`} className="hint" role="status">
        {message}
      </p>
      {props.error ? (
        <p id={`${id}-error`} className="field-error">
          {t("cvReview.invalidValue")}
        </p>
      ) : null}
    </fieldset>
  );
}
