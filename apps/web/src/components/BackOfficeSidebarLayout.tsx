"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { BackOfficeNavGroup } from "@/admin/back-office-nav";
import { Icons } from "@/components/icons";
import { BackOfficeAssistantToggle } from "@/components/BackOfficeAssistantPanel";
import { CURRENT, SidebarShell } from "@/components/SidebarShell";
import { routes } from "@/routes";

const isUnder = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/**
 * The Back Office's sidebar layout (#204, Notion design language of map #123):
 * the sections an Administrator's roles cover, by group, each group named; the
 * Back Office Assistant in the top bar, on every page. `groups` holds only what they may see; the Dashboard, the
 * Back Office's home, comes first for everyone (#408). Last, Mon compte and the public Légal (#544).
 * Its foot names the Version served, `release` (#559).
 */
export function BackOfficeSidebarLayout({
  groups,
  title,
  release,
  children,
}: {
  groups: ReadonlyArray<BackOfficeNavGroup>;
  title?: ReactNode;
  /** The Version as shown (`releaseLabel`): « X.Y.Z (main·sha) » on the Beta, « X.Y.Z » in Production. */
  release: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <SidebarShell
      brand={{ href: routes.admin, label: `${t("app.name")} · ${t("admin.title")}` }}
      title={title}
      topBarEnd={<BackOfficeAssistantToggle />}
      foot={() => <p className="release-line">{t("release.line", { version: release })}</p>}
      nav={(closeDrawer) => (
        <nav className="sidebar-nav" aria-label={t("admin.nav.label")}>
          {/* The Back Office Dashboard, its home (#408): every Administrator's first entry. */}
          <ul className="sidebar-group">
            <li>
              <Link className="sidebar-link" href={routes.admin} aria-current={pathname === routes.admin ? CURRENT : undefined} onClick={closeDrawer}>
                <Icons.dashboard />
                {t("admin.nav.dashboard")}
              </Link>
            </li>
          </ul>
          {groups.map((group) => (
            <div key={group.key} className="sidebar-group">
              <h2 className="sidebar-group-label" id={`back-office-group-${group.key}`}>
                {t(`admin.nav.groups.${group.key}`)}
              </h2>
              <ul aria-labelledby={`back-office-group-${group.key}`}>
                {group.sections.map((section) => {
                  const SectionIcon = Icons[section.key];
                  return (
                    <li key={section.key}>
                      <Link
                        className="sidebar-link"
                        href={section.href}
                        aria-current={isUnder(pathname, section.href) ? CURRENT : undefined}
                        onClick={closeDrawer}
                      >
                        <SectionIcon />
                        {t(`admin.sections.${section.key}`)}
                        {section.count === undefined ? null : (
                          <span className="sidebar-count">
                            <span aria-hidden="true">{section.count}</span>
                            <span className="visually-hidden">{t("admin.nav.toHandle", { count: section.count })}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <ul className="sidebar-group">
            <li>
              <Link className="sidebar-link" href={routes.account} onClick={closeDrawer}>
                <Icons.account />
                {t("admin.nav.account")}
              </Link>
            </li>
            {/* The public Légal (#544); the Back Office's own help, /admin/aide, joins it with #551. */}
            <li>
              <Link className="sidebar-link" href={routes.legal()} onClick={closeDrawer}>
                <Icons.legal />
                {t("admin.nav.publicLegal")}
              </Link>
            </li>
          </ul>
        </nav>
      )}
    >
      {children}
    </SidebarShell>
  );
}
