import Link from "next/link";
import type { ReactNode } from "react";
import "./FilterLinks.css";

/** How the filter shown says so to assistive technologies. */
const CURRENT = "page";

export type FilterLink = { id: string; href: string; label: ReactNode };

/**
 * Filters whose choice is in the address (#466): a list's « Tous les types · Bug · Idée », Activité's sections. One
 * wrapping line of chips, the one shown filled; each a link in a navigation named by `label`, the shown one
 * `aria-current="page"`. A server page draws the list it filters, so a reload keeps the filter.
 */
export function FilterLinks({ label, links, shown }: { label: string; links: readonly FilterLink[]; shown: string }) {
  return (
    <nav aria-label={label}>
      <ul className="ds-filters">
        {links.map((link) => (
          <li key={link.id}>
            <Link prefetch={false} className="ds-filters__link" href={link.href} aria-current={link.id === shown ? CURRENT : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
