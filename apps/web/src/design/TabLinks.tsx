import Link from "next/link";
import type { ReactNode } from "react";
import "./Tabs.css";

export type TabLink = { id: string; href: string; label: ReactNode };

/** How a tab says it is shown: to its style (as the Tabs' Radix tabs do) and to assistive technologies. */
const STATE = { shown: "active", hidden: "inactive" } as const;
const CURRENT = "page";

/**
 * Tabs whose tab is in the address (#465): Paramètres' `?tab=`, Activité's pages. The Tabs' look, one line over a
 * hairline that scrolls sideways on a phone, the shown one underlined; each tab a link in a navigation named by
 * `label`, the shown one `aria-current="page"`. A server page draws the panel of the tab shown, so a reload keeps it.
 */
export function TabLinks({ label, tabs, shown }: { label: string; tabs: readonly TabLink[]; shown: string }) {
  return (
    <nav aria-label={label}>
      <ul className="ds-tabs__list ds-tabs__list--links">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link prefetch={false} className="ds-tabs__tab" href={tab.href} data-state={tab.id === shown ? STATE.shown : STATE.hidden} aria-current={tab.id === shown ? CURRENT : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
