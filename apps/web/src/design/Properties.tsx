import type { ReactNode } from "react";
import "./Properties.css";

/**
 * A thing's properties, read-only (#466): a description list, each term beside its value on a wide screen, above it on
 * a phone. A Tool's details, an AI call's, a Signalement's context, a Playbook Version's. `label` names the list for
 * screen readers when no heading does.
 */
export function Properties({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <dl className="ds-props" aria-label={label}>
      {children}
    </dl>
  );
}

/**
 * One property: its `term`, its value (`children`, in `lang` when written in another language than the page's) and
 * `meta`, what goes with the value (its version, who validated it), under it in the metadata style.
 */
export function Property({ term, lang, meta, children }: { term: ReactNode; lang?: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-prop">
      <dt>{term}</dt>
      <dd lang={lang}>{children}</dd>
      {meta ? <dd className="ds-prop__meta">{meta}</dd> : null}
    </div>
  );
}
