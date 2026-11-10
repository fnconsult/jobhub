"use client";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { SidebarShell, CURRENT } from "@/components/SidebarShell";
import { OverlayScope } from "@/design/overlay";
import type { Association } from "./index";
import "@/coach-space/coach-space.css";
const DENSITY = "confort",
  DOCK_AT = "48rem",
  CONTRACT = "/espace-coach/contrat",
  HELP = "/aide/espace-coach",
  ACCOUNT = "/compte";
export const ASSOCIATION_PAGES = ["coachs", "offres", "revenus", "membres"] as const;
export function AssociationLayout({
  association,
  page,
  children,
}: {
  association: Pick<Association, "id" | "name">;
  page: (typeof ASSOCIATION_PAGES)[number] | "contrat";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <OverlayScope className="coach-space-v2" data-density={DENSITY}>
      <SidebarShell
        dockAt={DOCK_AT}
        brand={{ href: `/espace-association/${association.id}/coachs`, label: association.name }}
        title={page === "contrat" ? t("coachSpaceV2.pages.contrat") : t(`association.pages.${page}`)}
        nav={(close) => (
          <nav className="sidebar-nav" aria-label={t("association.title")}>
            <ul className="sidebar-group">
              {ASSOCIATION_PAGES.map((key) => (
                <li key={key}>
                  <Link
                    className="sidebar-link"
                    href={`/espace-association/${association.id}/${key}`}
                    onClick={close}
                    aria-current={key === page ? CURRENT : undefined}
                  >
                    {t(`association.pages.${key}`)}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  className="sidebar-link"
                  href={`${CONTRACT}?association=${association.id}`}
                  onClick={close}
                  aria-current={page === "contrat" ? CURRENT : undefined}
                >
                  {t("coachSpaceV2.pages.contrat")}
                </Link>
              </li>
              <li>
                <Link className="sidebar-link" href={HELP} onClick={close}>
                  {t("coachSpaceV2.pages.aide")}
                </Link>
              </li>
            </ul>
          </nav>
        )}
        foot={(close) => (
          <Link className="sidebar-link" href={ACCOUNT} onClick={close}>
            {t("nav.account")}
          </Link>
        )}
      >
        <div className="coach-space-cards">{children}</div>
      </SidebarShell>
    </OverlayScope>
  );
}
