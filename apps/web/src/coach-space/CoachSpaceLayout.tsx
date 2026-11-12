"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SidebarShell, CURRENT } from "@/components/SidebarShell";
import { Button } from "@/design/Button";
import { Drawer } from "@/design/Drawer";
import { OverlayScope } from "@/design/overlay";
import { routes } from "@/routes";
import { COACH_SPACE_PAGES, coachSpacePage } from "./navigation";
import "./coach-space.css";

const DENSITY = "confort";
const DOCK_AT = "48rem";
const HOME = coachSpacePage("aujourdhui");

/** The coach's own Mercury navigation, including the app's WebView (ADR-0084). */
export function CoachSpaceLayout({ children,remindersEnabled=false }: { children: ReactNode;remindersEnabled?:boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const current = COACH_SPACE_PAGES.find((page) => pathname === coachSpacePage(page) || pathname.startsWith(`${coachSpacePage(page)}/`));
  return (
    <OverlayScope className="coach-space-v2" data-density={DENSITY}>
      <SidebarShell
        dockAt={DOCK_AT}
        brand={{ href: HOME, label: `${t("app.name")} · ${t("coachSpace.title")}` }}
        title={t(current ? `coachSpaceV2.pages.${current}` : "coachSpace.title")}
        topBarEnd={<Drawer title={t("coachSpaceV2.notifications")} trigger={<Button type="button">{t("coachSpaceV2.notifications")}</Button>}><p>{t("coachSpaceV2.noNotifications")}</p></Drawer>}
        nav={(close) => (
          <nav className="sidebar-nav" aria-label={t("coachSpace.title")}>
            <ul className="sidebar-group">
              {COACH_SPACE_PAGES.filter(page=>page!=="rappels"||remindersEnabled).map((page) => <li key={page}><Link className="sidebar-link" href={coachSpacePage(page)} aria-current={current === page ? CURRENT : undefined} onClick={close}>{t(`coachSpaceV2.pages.${page}`)}</Link></li>)}
            </ul>
          </nav>
        )}
        foot={(close) => <Link className="sidebar-link" href={routes.account} onClick={close}>{t("nav.account")}</Link>}
      >
        <div className="coach-space-column">{children}</div>
      </SidebarShell>
    </OverlayScope>
  );
}
