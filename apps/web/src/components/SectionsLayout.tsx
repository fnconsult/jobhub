"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useEffect, type ReactNode } from "react";
import { Icons } from "@/components/icons";
import { CURRENT, SidebarSections, TopBarBack } from "@/components/SidebarShell";

/** Below this width the list is the page and each Section shows alone. */
const NARROW = "(width < 64rem)";

export type SectionLink = { href: string; label: string };

/**
 * A page split into Sections (ADR-0024), each with its own address. From 64rem
 * the Sections are listed beside the one shown; `base` (the page's own address)
 * shows the first one. Below 64rem `base` is the list, and every other Section
 * is shown alone, sliding in like a sheet, with the Top Bar's title turned into
 * a way back to the list behind an arrow (iOS style): a page styled as a
 * drawer, so the back button, links and screen readers work as on any page.
 */
export function SectionsLayout({
  base,
  label,
  backLabel,
  sections,
  children,
}: {
  base: string;
  label: string;
  backLabel: string;
  sections: ReadonlyArray<SectionLink>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const atBase = pathname === base;
  const setBack = useContext(TopBarBack);
  useEffect(() => {
    const narrow = window.matchMedia(NARROW);
    const sync = () => setBack(!atBase && narrow.matches ? { href: base, label: backLabel } : null);
    sync();
    narrow.addEventListener("change", sync);
    return () => {
      narrow.removeEventListener("change", sync);
      setBack(null);
    };
  }, [atBase, base, backLabel, setBack]);
  // The page's own address shows the first Section.
  const shown = atBase ? sections[0]?.href : sections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))?.href;
  // The sidebar lists them in its place when the page's column is too narrow (see SidebarShell).
  const setSidebarSections = useContext(SidebarSections);
  const items = JSON.stringify(sections.map((section) => ({ ...section, current: section.href === shown })));
  useEffect(() => {
    setSidebarSections({ title: backLabel, label, items: JSON.parse(items) });
    return () => setSidebarSections(null);
  }, [setSidebarSections, backLabel, label, items]);
  return (
    <div className="sections" data-at-list={atBase || undefined}>
      <nav className="sections-nav" aria-label={label}>
        <ul>
          {sections.map((section) => (
            <li key={section.href}>
              <Link className="sidebar-link" href={section.href} aria-current={section.href === shown ? CURRENT : undefined}>
                {section.label}
                <Icons.chevron />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sections-content">{children}</div>
    </div>
  );
}
