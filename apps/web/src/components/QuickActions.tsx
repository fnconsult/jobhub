"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useOpenCoachPanel } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/button-class";
import { routes } from "@/routes";
import "./QuickActions.css";

/**
 * The quick actions on the Candidate's home page (#467, the Design System's prototype): a row of pills, the first
 * one the accent. « Chercher des offres » leads to Recherches d'offres and « Planifier un entretien » to the Agenda;
 * « Ajouter une candidature » and « Demander au coach » open the Coach Panel, where the Candidate gives the AI Coach a
 * Job Offer link to save, or asks anything. Outside a Coach Panel only the links are shown.
 */
export function QuickActions() {
  const { t } = useTranslation();
  const openCoach = useOpenCoachPanel();
  const chip = buttonClass({ size: "sm" });
  return (
    <nav className="quick-actions" aria-label={t("quickActions.label")}>
      <Link className={buttonClass({ variant: "primary", size: "sm" })} href={routes.jobSearches()}>
        <Icons.jobSearches />
        {t("quickActions.searchJobOffers")}
      </Link>
      {openCoach ? (
        <button className={chip} type="button" onClick={openCoach}>
          <Icons.add />
          {t("quickActions.addApplication")}
        </button>
      ) : null}
      <Link className={chip} href={routes.agenda()}>
        <Icons.agenda />
        {t("quickActions.scheduleInterview")}
      </Link>
      {openCoach ? (
        <button className={chip} type="button" onClick={openCoach}>
          <Icons.coach />
          {t("quickActions.askCoach")}
        </button>
      ) : null}
    </nav>
  );
}
