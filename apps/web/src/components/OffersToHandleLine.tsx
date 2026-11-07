import type { TFunction } from "i18next";
import Link from "next/link";
import { routes } from "@/routes";

/**
 * « Il vous reste N offres à traiter » (#818, ADR-0090): the Candidate's Offer box entries à traiter (`offersToHandle`),
 * leading to Recherches d'offres, as the Job Digest's email ends with it. Nothing at 0.
 */
export function OffersToHandleLine({ count, t }: { count: number; t: TFunction }) {
  if (count <= 0) return null;
  return (
    <p>
      <Link href={routes.jobSearches()}>{t("jobDigest.offersToHandle", { count })}</Link>
    </p>
  );
}
