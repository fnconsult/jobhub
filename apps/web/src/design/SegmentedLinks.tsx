import Link from "next/link";
import type { ReactNode } from "react";
import "./Field.css";

/** How the view shown says so to assistive technologies. */
const CURRENT = "page";

export type SegmentedLink = { id: string; href: string; label: ReactNode };

/**
 * A segmented control whose choice is in the address (#469): the Agenda's « Liste · Semaine · Mois ». The
 * SegmentedControl's look, one pill with the shown option raised; each option a link in a navigation named by
 * `label`, the shown one `aria-current="page"`. A server page draws the view shown, so a reload or a shared link keeps it.
 */
export function SegmentedLinks({ label, links, shown }: { label: string; links: readonly SegmentedLink[]; shown: string }) {
  return (
    <nav aria-label={label}>
      <ul className="ds-segmented ds-segmented--links">
        {links.map((link) => (
          <li key={link.id}>
            <Link prefetch={false} className="ds-segmented__option" href={link.href} aria-current={link.id === shown ? CURRENT : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
