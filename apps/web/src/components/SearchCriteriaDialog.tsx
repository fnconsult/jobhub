"use client";

import type { SearchCriteria } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Drawer } from "@/design/Drawer";
import { SearchCriteriaProperties } from "./ProfileInlineEdits";

/**
 * "Modifier les critères" (#237): a button opening a Drawer (#462) with only
 * the Profile's Search Criteria, laid out and saved on change as on the Profile page, since it
 * is the same `SearchCriteriaProperties`. Escape or its « Fermer » button closes it, the focus back on
 * the button, and the page refreshes so its Search Criteria in words say the change.
 */
export function SearchCriteriaDialog({ profileId, profileName, searchCriteria }: { profileId: string; profileName: string; searchCriteria: SearchCriteria }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.refresh();
      }}
      trigger={
        <button className="props-action link-action" type="button">
          {t("jobSearch.editCriteria")}
        </button>
      }
      title={t("jobSearch.criteriaDialog.title", { profile: profileName })}
      onEscapeKeyDown={(event) => {
        // Escape in the Locations input closes its suggestions, then empties it (#235); only then the drawer.
        const target = event.target;
        if (target instanceof HTMLInputElement && target.getAttribute("role") === "combobox" && (target.getAttribute("aria-expanded") === "true" || target.value !== "")) {
          event.preventDefault();
        }
      }}
      onOpenAutoFocus={(event) => {
        // Focus on the drawer itself, which is announced by its title: on the first field, the
        // target role would be selected whole, one keystroke away from being replaced.
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      {/* Styled as on the Profile page's document; mounted on each opening, from the Search Criteria as the page last read them. */}
      <div className="document">
        <SearchCriteriaProperties profileId={profileId} searchCriteria={searchCriteria} />
      </div>
    </Drawer>
  );
}
