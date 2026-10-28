import type { ReactNode } from "react";
import "./EmptyState.css";

/** The default illustration: an empty list with a plus, in the accent colour. Decoration only. */
function EmptyArt() {
  return (
    <svg className="ds-empty__art" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden focusable={false}>
      <rect x="18" y="24" width="60" height="48" rx="8" opacity=".35" />
      <rect x="26" y="32" width="44" height="6" rx="3" fill="currentColor" opacity=".15" stroke="none" />
      <rect x="26" y="44" width="30" height="4" rx="2" fill="currentColor" opacity=".12" stroke="none" />
      <rect x="26" y="53" width="36" height="4" rx="2" fill="currentColor" opacity=".12" stroke="none" />
      <circle className="ds-empty__art-badge" cx="70" cy="66" r="12" />
      <path d="M65 66h10M70 61v10" />
    </svg>
  );
}

/**
 * What a page shows while it has nothing to list (#462): an illustration, a `title` (a heading, level 2 unless told),
 * a short text, its `actions` and a `help` link (an EmptyStateHelp, ADR-0035), centred.
 */
export function EmptyState({
  title,
  headingLevel = 2,
  art,
  actions,
  help,
  children,
}: {
  title: ReactNode;
  headingLevel?: 2 | 3;
  art?: ReactNode;
  actions?: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className="ds-empty">
      {art ?? <EmptyArt />}
      <Heading className="ds-empty__title">{title}</Heading>
      {children ? <p className="ds-empty__text">{children}</p> : null}
      {actions ? <div className="ds-empty__actions">{actions}</div> : null}
      {help ? <div className="ds-empty__help">{help}</div> : null}
    </section>
  );
}
