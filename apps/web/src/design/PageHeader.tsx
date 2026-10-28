import type { ReactNode } from "react";
import "./PageHeader.css";

/** The head of a page (#462): an `eyebrow` (where it sits, « Plateforme »), its one level-1 heading, a subtitle and its actions. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__text">
        {eyebrow ? <p className="ds-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="ds-page-header__title">{title}</h1>
        {subtitle ? <p className="ds-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
    </header>
  );
}
