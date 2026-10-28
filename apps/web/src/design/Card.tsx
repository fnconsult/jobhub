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

export type Trend = { direction: "up" | "down"; tone: "success" | "danger" | "neutral"; text: ReactNode };

/**
 * A figure on a card (a Back Office Dashboard's): its `label` (may hold a HelpTerm), its `value`, a line of metadata,
 * a progress bar towards a threshold (`progress`, in percent, kept between 0 and 100) and a trend in words, its arrow
 * only repeating them.
 */
export function Stat({ label, value, meta, progress, trend }: { label: string; value: ReactNode; meta?: ReactNode; progress?: number; trend?: Trend }) {
  const percent = progress === undefined ? undefined : Math.min(100, Math.max(0, Math.round(progress)));
  const Arrow = trend?.direction === "down" ? Icons.trendDown : Icons.trendUp;
  return (
    <div className="ds-card ds-stat" data-stat>
      <div className="ds-stat__label">{label}</div>
      <div className="ds-stat__value">{value}</div>
      {meta ? <div className="ds-stat__meta">{meta}</div> : null}
      {percent !== undefined ? (
        <div className="ds-stat__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {trend ? (
        <div className="ds-stat__trend" data-tone={trend.tone}>
          <Arrow />
          {trend.text}
        </div>
      ) : null}
    </div>
  );
}
