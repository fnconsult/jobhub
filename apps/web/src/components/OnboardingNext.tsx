"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOpenCoachHelp } from "@/components/CoachConversationPage";
import { buttonClass } from "@/design/button-class";
import { routes } from "@/routes";

/**
 * « Et maintenant ? » (#1053, decision #1044): the end of the onboarding, once « Cela semble correct » saved the Profile.
 * Short, and leading to the offers: two actions in a labelled group, « Voir mes offres à traiter » (the Offer box, for the
 * Profile) first, the focus on it, then « Continuer vers mon profil »; under them, one line to the Coach Panel's help, where
 * what else Jobbbox does is shown (« Pour bien commencer », #1069), not here. The help opens only on a page that is a
 * conversation (`useOpenCoachHelp`): without one, the line is not shown.
 */
export function OnboardingNext({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const openHelp = useOpenCoachHelp();
  const first = useRef<HTMLAnchorElement>(null);
  // Saved, the button is gone: the focus goes to where the Candidate goes next.
  useEffect(() => first.current?.focus(), []);
  return (
    <>
      <div className="onb-next quick-actions" role="group" aria-label={t("newProfile.next.label")}>
        <Link ref={first} className={buttonClass({ variant: "primary", size: "sm" })} href={routes.jobSearches(profileId)}>
          {t("newProfile.next.offers")}
        </Link>
        <Link className={buttonClass({ variant: "secondary", size: "sm" })} href={routes.profile(profileId)}>
          {t("onboardingSummary.toProfile")}
        </Link>
      </div>
      {openHelp ? (
        <p>
          <button type="button" className="link-action" onClick={openHelp}>
            {t("newProfile.next.help")}
          </button>
        </p>
      ) : null}
    </>
  );
}
