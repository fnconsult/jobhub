"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import { CURRENT } from "@/components/SidebarShell";

export type SectionLink = { href: string; label: string };

/**
 * A page split into Sections (ADR-0024), each with its own address. From 64rem
 * the Sections are listed beside the one shown; `base` (the page's own address)
 * shows the first one. Below 64rem `base` is the list, and every other Section
 * is shown alone as a full-height sheet with a way back to the list: a page
 * styled as a drawer, so the back button, links and screen readers work as on
 * any page.
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
  // The page's own address shows the first Section.
  const shown = atBase ? sections[0]?.href : sections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))?.href;
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
      <div className="sections-content">
        <Link className="sections-back" href={base}>
          <Icons.back />
          {backLabel}
        </Link>
        {children}
      </div>
    </div>
  );
}
