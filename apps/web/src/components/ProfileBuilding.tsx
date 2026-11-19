"use client";

import { usePathname } from "next/navigation";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { followedOn } from "@/ai-activity/followed-search";
import { isRunning } from "@/ai-activity/live";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { Properties, Property } from "@/design/Properties";
import { profileBuilding } from "@/first-welcome";
import { routes } from "@/routes";

/**
 * The Profile in construction (#1051), at the top of Activité in the first welcome's split, so that it is never empty
 * before the Profile is born: its CV (not sent yet, being read, read, or none), its target role and its places as the
 * Candidate answers or validates them, each « Pas encore dans votre profil » until then. Read from what the creation
 * page tells AI Activity (ai-activity/creation); once the offered Job Search starts, its progress in « En ce moment »
 * takes its place. Shown, never read out as it fills: the conversation says each answer already.
 */
export function ProfileBuilding() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const titleId = useId();
  const store = useAiActivityLive();
  if (!store || followedOn(store.followed, pathname) !== null) return null;
  const cvReading = store.actions.some((action) => action.kind === "cv_reading" && action.href === routes.newProfile && isRunning(action));
  const { cv, targetRole, locations } = profileBuilding({ creation: store.creation, cvReading });
  const missing = <em>{t("newProfile.firstWelcome.building.missing")}</em>;
  return (
    <section className="panel-section first-welcome-building" aria-labelledby={titleId}>
      <h3 id={titleId} className="panel-section-title">
        {t("newProfile.firstWelcome.building.label")}
      </h3>
      <p className="hint">{t("newProfile.firstWelcome.building.intro")}</p>
      <Properties>
        <Property term={t("newProfile.firstWelcome.building.cv")}>{t(`newProfile.firstWelcome.building.cvStates.${cv}`)}</Property>
        <Property term={t("newProfile.firstWelcome.building.targetRole")}>{targetRole ?? missing}</Property>
        <Property term={t("newProfile.firstWelcome.building.locations")}>{locations.length > 0 ? locations.join(", ") : missing}</Property>
      </Properties>
    </section>
  );
}
