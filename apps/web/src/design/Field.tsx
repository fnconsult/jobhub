"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import "./Field.css";

/** What a Field or a KeyValueRow tells the one control it holds: its id and how it is labelled and described. */
type ControlWiring = {
  id: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

const Wiring = createContext<ControlWiring | null>(null);

/** The wiring of the control inside a Field or a KeyValueRow, merged under what the control was given. */
function useWiring<T extends { id?: string; "aria-describedby"?: string }>(props: T): T & Partial<ControlWiring> {
  const wiring = useContext(Wiring);
  if (!wiring) return props;
  const describedBy = [wiring["aria-describedby"], props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return { ...wiring, ...props, id: props.id ?? wiring.id, "aria-describedby": describedBy };
}

/**
 * A labelled form field (#462): its label above, its one control (TextInput, Select or Textarea) named by it, a hint
 * under it, and the error that replaces nothing (the hint stays) and marks the control invalid. The control is
 * described by the hint then the error, so a screen reader reads both.
 */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const wiring: ControlWiring = {
    id: `${id}-control`,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    "aria-invalid": error ? true : undefined,
  };
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={wiring.id}>
        {label}
      </label>
      <Wiring.Provider value={wiring}>{children}</Wiring.Provider>
      {hint ? (
        <p id={hintId} className="ds-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ds-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");

export function TextInput({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} type="text" {...useWiring(props)} className={join("ds-input", className)} />;
}

export function Select({ className, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return <select ref={ref} {...useWiring(props)} className={join("ds-input", "ds-select", className)} />;
}

export function Textarea({ className, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} rows={3} {...useWiring(props)} className={join("ds-input", "ds-textarea", className)} />;
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode };

/** A checkbox, its words beside it: the whole line is its target. */
export function Checkbox({ label, className, ...props }: ChoiceProps) {
  return (
    <label className={join("ds-choice", className)}>
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

/** A radio button, its words beside it: the whole line is its target. */
export function Radio({ label, className, ...props }: ChoiceProps) {
  return (
    <label className={join("ds-choice", className)}>
      <input type="radio" {...props} />
      {label}
    </label>
  );
}

/**
 * An on/off switch (`role="switch"`), its words beside it naming it. Space or Enter flips it; it says « on » or
 * « off » through `aria-checked`, never through its colour alone.
 */
export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="ds-switch-row">
      <button
        type="button"
        role="switch"
        className="ds-switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      />
      <span id={`${id}-label`}>{label}</span>
    </span>
  );
}

export type SegmentedOption<V extends string> = { value: V; label: ReactNode };

const NEXT_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A segmented control (« Semaine · Mois · Année »): a radio group drawn as one pill. It takes one Tab stop, on the
 * chosen option; the arrow keys move the choice and the focus, wrapping round, and Home and End go to the ends
 * (WAI-ARIA radio group). `label` names the group for screen readers.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  function choose(index: number) {
    const option = options[(index + options.length) % options.length]!;
    onValueChange(option.value);
    group.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(option.value)}"]`)?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = options.findIndex((option) => option.value === value);
    if (event.key in NEXT_KEYS) choose(current + NEXT_KEYS[event.key]!);
    else if (event.key === "Home") choose(0);
    else if (event.key === "End") choose(options.length - 1);
    else return;
    event.preventDefault();
  }
  return (
    <div ref={group} role="radiogroup" aria-label={label} className="ds-segmented" onKeyDown={onKeyDown}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            data-value={option.value}
            className="ds-segmented__option"
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One setting on a line (Paramètres): its key, its control named by that key, and a Pill saying where the value
 * comes from (« Back Office », « env », « défaut du code »). The key may hold a HelpTerm.
 */
export function KeyValueRow({ label, source, children }: { label: ReactNode; source?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="ds-kv">
      <span id={`${id}-key`} className="ds-kv__key">
        {label}
      </span>
      <Wiring.Provider value={{ id: `${id}-control`, "aria-labelledby": `${id}-key` }}>{children}</Wiring.Provider>
      <span className="ds-kv__source">{source}</span>
    </div>
  );
}
