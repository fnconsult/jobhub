"use client";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import type { PublicCoachPage } from "@jobhub/shared/coaching-profiles";
import "./coach-pages.css";
/** The same moderated text/photo layout is used for the Candidate, the coach's live preview and the moderator. */
export function PublicCoachProfile({ name, page }: { name: string; page: Omit<PublicCoachPage, "versionId"> }) {
  const { t } = useTranslation();
  return (
    <div className="coach-public-profile stack">
      {page.photoUrl ? (
        <Image className="coach-public-photo" src={page.photoUrl} alt={t("coachPage.photoAlt", { name })} width={96} height={96} unoptimized />
      ) : null}
      <p className="coach-public-presentation">{page.presentation}</p>
      {page.specialties.length ? (
        <p>{t("coachPage.specialtiesList", { list: page.specialties.join(", ") })}</p>
      ) : null}
      {page.languages.length ? (
        <p>{t("coachPage.languagesList", { list: page.languages.join(", ") })}</p>
      ) : null}
    </div>
  );
}
