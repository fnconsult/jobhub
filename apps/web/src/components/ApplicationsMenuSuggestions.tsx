"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useFocusCoachBox } from "@/components/CoachConversationPage";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/button-class";
import type { FollowUpNotice } from "@/follow-ups";
import { routes } from "@/routes";
import "./QuickActions.css";

/** How many of the Applications à traiter are suggested, the most recent first. */
const SUGGESTED_TO_HANDLE = 2;

/**
 * Mes candidatures' suggestions above the box (#604), until the first message: the Applications à traiter first (a
 * Follow-up ready, or still no answer), each to its page; then « Ajouter une candidature », which puts the focus in the box
 * for a Job Offer link to save, and « Chercher des offres », to Recherches d'offres.
 */
export function ApplicationsMenuSuggestions({ toHandle }: { toHandle: readonly { applicationId: string; title: string; kind: FollowUpNotice["kind"] }[] }) {
  const { t } = useTranslation();
  const openCoach = useFocusCoachBox();
  const chip = buttonClass({ size: "sm" });
  return (
    <nav className="quick-actions" aria-label={t("quickActions.label")}>
      {toHandle.slice(0, SUGGESTED_TO_HANDLE).map((each) => (
        <Link key={each.applicationId} className={chip} href={routes.application(each.applicationId)}>
          {t(each.kind === "follow_up" ? "followUps.noticeFollowUp" : "followUps.noticeAbandon", { title: each.title })}
        </Link>
      ))}
      {openCoach ? (
        <button className={chip} type="button" onClick={openCoach}>
          <Icons.add />
          {t("quickActions.addApplication")}
        </button>
      ) : null}
      <Link className={chip} href={routes.jobSearches()}>
        <Icons.jobSearches />
        {t("quickActions.searchJobOffers")}
      </Link>
    </nav>
  );
}
