import type { ReactNode } from "react";
import "./PageHeader.css";

/**
 * The head of a page (#462): an `eyebrow` (where it sits, « Plateforme »), its one level-1 heading, a subtitle and its
 * actions. On a page whose title is already its level-1 heading (the Back Office's top bar), a `headingLevel` of 2.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  headingLevel = 1,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__text">
        {eyebrow ? <p className="ds-page-header__eyebrow">{eyebrow}</p> : null}
        <Heading className="ds-page-header__title">{title}</Heading>
        {subtitle ? <p className="ds-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
    </header>
  );
}
