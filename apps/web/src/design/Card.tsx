import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import "./Card.css";

/** A card: a bordered surface, titled (a heading, level 2 unless told) with its `actions` at the end of the title line. */
export function Card({
  title,
  headingLevel = 2,
  actions,
  flat = false,
  children,
}: {
  title?: ReactNode;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
  /** On the surface colour, without a shadow: a card inside a card. */
  flat?: boolean;
  children: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className="ds-card" data-flat={flat || undefined}>
      {title || actions ? (
        <div className="ds-card__head">
          {title ? <Heading className="ds-card__title">{title}</Heading> : null}
          {actions ? <div className="ds-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A figure on a card (a Dashboard's chart): its `caption` first, in the card title's style, then the chart and what
 * goes with it (its legend, its table view). A `figure` named by its caption, so a screen reader lists it as one.
 */
export function FigureCard({ caption, className, children }: { caption: ReactNode; className?: string; children: ReactNode }) {
  return (
    <figure className={["ds-card", "ds-figure", className].filter(Boolean).join(" ")}>
      <figcaption className="ds-card__title">{caption}</figcaption>
      {children}
    </figure>
  );
}

export type Trend = { direction: "up" | "down"; tone: "success" | "danger" | "neutral"; text: ReactNode };

/** A row of Stat cards (a Back Office Dashboard's figures): a description list, each Stat a term and its values. */
export function Stats({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <dl className="ds-stats" aria-label={label}>
      {children}
    </dl>
  );
}

/**
 * A figure on a card, inside Stats: its `label` (a term, which may be an Explainable label or a HelpTerm), its `value`,
 * a line of metadata, a `note` under it (a link to its detail), a progress bar towards a limit (`progress`, in percent,
 * drawn between 0 and 100, in the danger colour from 100: the limit is reached) and a trend in words, its arrow only
 * repeating them. `name` names the progress bar when the label is not plain words.
 */
export function Stat({ label, name, value, meta, note, progress, trend }: { label: ReactNode; name?: string; value: ReactNode; meta?: ReactNode; note?: ReactNode; progress?: number; trend?: Trend }) {
  const percent = progress === undefined ? undefined : Math.min(100, Math.max(0, Math.round(progress)));
  const Arrow = trend?.direction === "down" ? Icons.trendDown : Icons.trendUp;
  return (
    <div className="ds-card ds-stat" data-stat>
      <dt className="ds-stat__label">{label}</dt>
      <dd className="ds-stat__value">{value}</dd>
      {meta ? <dd className="ds-stat__meta">{meta}</dd> : null}
      {note ? <dd className="ds-stat__meta">{note}</dd> : null}
      {percent !== undefined ? (
        <dd
          className="ds-stat__bar"
          role="progressbar"
          aria-label={name ?? (typeof label === "string" ? label : undefined)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          data-reached={progress !== undefined && progress >= 100 ? true : undefined}
        >
          <span style={{ width: `${percent}%` }} />
        </dd>
      ) : null}
      {trend ? (
        <dd className="ds-stat__trend" data-tone={trend.tone}>
          <Arrow />
          {trend.text}
        </dd>
      ) : null}
    </div>
  );
}
