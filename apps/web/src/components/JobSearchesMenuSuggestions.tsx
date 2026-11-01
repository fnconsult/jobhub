"use client";

import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import "./QuickActions.css";

/** How many active Profiles get their own « Lancer une recherche », in the Profiles' order. */
const SUGGESTED_PROFILES = 3;

/**
 * Recherches d'offres' suggestions above the box (#606), until the first message: « Lancer une recherche », which starts
 * a Job Search and opens its page; one per active Profile, named after it, when the Candidate has several. None without
 * an active Profile (the card says how to create one).
 */
export function JobSearchesMenuSuggestions({ profiles }: { profiles: readonly { id: string; name: string }[] }) {
  const { t } = useTranslation();
  if (profiles.length === 0) return null;
  const several = profiles.length > 1;
  return (
    <nav className="quick-actions" aria-label={t("quickActions.label")}>
      {profiles.slice(0, SUGGESTED_PROFILES).map((profile) => (
        <StartJobSearchButton
          key={profile.id}
          profileId={profile.id}
          variant="secondary"
          size="sm"
          icon={<Icons.jobSearches />}
          label={several ? t("jobSearchesMenu.startFor", { profile: profile.name }) : t("jobSearchesMenu.start")}
        />
      ))}
    </nav>
  );
}
