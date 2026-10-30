"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useEffect, type ReactNode } from "react";
import { Icons } from "@/components/icons";
import { CURRENT, SidebarSections, TopBarBack } from "@/components/SidebarShell";
import "./SectionsTabs.css";

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
 * `look="tabs"` (an Application's page, #467): from 64rem the Sections are tabs in one line above the one shown,
 * the Design System's tab look, scrolling sideways when they do not fit; they never move to the sidebar. Below
 * 64rem, the list and each Section alone, as with the list look.
 */
export function SectionsLayout({
  base,
  label,
  backLabel,
  sections,
  look = "list",
  children,
}: {
  base: string;
  label: string;
  backLabel: string;
  sections: ReadonlyArray<SectionLink>;
  look?: "list" | "tabs";
  children: ReactNode;
}) {
  const pathname = usePathname();
  const atBase = pathname === base;
  // The page's own address shows the first Section.
  const shown = atBase ? sections[0]?.href : sections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))?.href;
  const shownLabel = sections.find((section) => section.href === shown)?.label;
  // The Top Bar names the Section shown (in place of its own heading, which only screen readers
  // hear), except on a phone's list; there a Section shown alone gets the back arrow too.
  const setTopBar = useContext(TopBarBack);
  useEffect(() => {
    const narrow = window.matchMedia(NARROW);
    const sync = () => {
      const phone = narrow.matches;
      if (!shownLabel || (phone && atBase)) setTopBar(null);
      else setTopBar({ section: shownLabel, back: phone ? { href: base, label: backLabel } : null });
    };
    sync();
    narrow.addEventListener("change", sync);
    return () => {
      narrow.removeEventListener("change", sync);
      setTopBar(null);
    };
  }, [atBase, base, backLabel, shownLabel, setTopBar]);
  // The sidebar lists them in its place when the page's column is too narrow (see SidebarShell); tabs fit any column.
  const setSidebarSections = useContext(SidebarSections);
  const items = JSON.stringify(sections.map((section) => ({ ...section, current: section.href === shown })));
  const tabs = look === "tabs";
  useEffect(() => {
    if (tabs) return;
    setSidebarSections({ title: backLabel, label, items: JSON.parse(items) });
    return () => setSidebarSections(null);
  }, [setSidebarSections, backLabel, label, items, tabs]);
  return (
    <div className="sections" data-at-list={atBase || undefined} data-look={tabs ? look : undefined}>
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
