"use client";

import { useTranslation } from "react-i18next";

/**
 * The « Origine » disclosure on an element a Coach proposal the Candidate applied changed (#715, ADR-0077): an Application
 * Status, an Interview, a Master CV Version, Search Criteria. Closed by default, nothing said; opened, it reveals « Sur
 * proposition de votre coach IA, appliqué par vous le 4 novembre 2026 à 18:20 ». `appliedAt`: an ISO date. Nothing for an
 * element with no Origin.
 */
export function OriginDisclosure({ appliedAt }: { appliedAt: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (!appliedAt) return null;
  const date = new Intl.DateTimeFormat(i18n.language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(appliedAt));
  return (
    <details className="origin-disclosure">
      <summary>{t("origin.label")}</summary>
      <p>{t("origin.coachProposal", { date })}</p>
    </details>
  );
}
