"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: ProfileFieldError | undefined;
  required?: boolean;
  multiline?: boolean;
  type?: "text" | "email" | "tel";
  /** Shows a numeric keypad on phones. */
  numeric?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const described = [props.hint ? `${id}-hint` : "", props.error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    className: "input",
    value: props.value,
    required: props.required,
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby": described,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.hint ? (
        <p id={`${id}-hint`} className="hint">
          {props.hint}
        </p>
      ) : null}
      {props.multiline ? (
        <textarea {...common} rows={4} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input {...common} type={props.type ?? "text"} inputMode={props.numeric ? "numeric" : undefined} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {props.error ? (
        <p id={`${id}-error`} className="field-error">
          {t(props.error.code === "required" ? "cvReview.required" : "cvReview.invalidValue")}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  error?: ProfileFieldError | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="input" value={props.value} aria-invalid={props.error ? true : undefined} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">{t("cvReview.notSpecified")}</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

type Direction = "up" | "down";

let lastEntryKey = 0;
const newEntryKey = () => ++lastEntryKey;

/**
 * The entries of one CV section, each in its own group, that the Candidate can
 * add, edit, move up or down, and remove. After a move the keyboard focus
 * follows the moved entry.
 */
export function EntryList<T>(props: {
  legend: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  itemLabel: (number: number) => string;
  addLabel: string;
  removeLabel: (number: number) => string;
  render: (item: T, replace: (item: T) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const { items, onChange } = props;
  // Stable React keys, so a moved entry keeps its DOM nodes (and focus) instead of its neighbour's.
  const [keys, setKeys] = useState(() => items.map(newEntryKey));
  // Items replaced from outside this list: fall back to positional keys until the next change here.
  const shownKeys = keys.length === items.length ? keys : items.map((_, i) => -(i + 1));
  const focusAfterMove = useRef<{ key: number; direction: Direction } | null>(null);
  const container = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    const moved = focusAfterMove.current;
    if (!moved) return;
    focusAfterMove.current = null;
    const entry = container.current?.querySelector(`[data-entry="${moved.key}"]`);
    // The same button if the entry can still move that way, otherwise the other one.
    for (const direction of [moved.direction, moved.direction === "up" ? "down" : "up"]) {
      const button = entry?.querySelector<HTMLButtonElement>(`[data-move="${direction}"]`);
      if (button && !button.disabled) {
        button.focus();
        return;
      }
    }
  });

  const update = (nextItems: T[], nextKeys: number[]) => {
    setKeys(nextKeys);
    onChange(nextItems);
  };
  const move = (index: number, direction: Direction) => {
    const target = direction === "up" ? index - 1 : index + 1;
    const swap = <V,>(values: V[]) => values.map((value, i) => (i === index ? values[target]! : i === target ? values[index]! : value));
    focusAfterMove.current = { key: shownKeys[index]!, direction };
    update(swap(items), swap(shownKeys));
  };

  return (
    <fieldset className="fieldset" ref={container}>
      <legend>{props.legend}</legend>
      {items.map((item, index) => {
        const label = props.itemLabel(index + 1);
        return (
          <fieldset className="fieldset entry" key={shownKeys[index]} data-entry={shownKeys[index]}>
            <legend>{label}</legend>
            {props.render(item, (next) => onChange(items.map((other, i) => (i === index ? next : other))))}
            <div className="actions">
              <button className="button" type="button" data-move="up" disabled={index === 0} onClick={() => move(index, "up")}>
                {t("cvReview.moveUp", { item: label })}
              </button>
              <button className="button" type="button" data-move="down" disabled={index === items.length - 1} onClick={() => move(index, "down")}>
                {t("cvReview.moveDown", { item: label })}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => update(items.filter((_, i) => i !== index), shownKeys.filter((_, i) => i !== index))}
              >
                {props.removeLabel(index + 1)}
              </button>
            </div>
          </fieldset>
        );
      })}
      <button className="button" type="button" onClick={() => update([...items, props.blank], [...shownKeys, newEntryKey()])}>
        {props.addLabel}
      </button>
    </fieldset>
  );
}
