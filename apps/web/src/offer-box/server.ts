import { cache } from "react";
import { sharedPool } from "@/database/pool";
import { getJobOffers } from "@/job-offers/server";
import { getProfiles } from "@/profiles/server";
import { createOfferBox, type OfferBox } from "./index";

let instance: OfferBox | undefined;

/** The app's Offer box (ADR-0090), on the database named by DATABASE_URL. */
export function getOfferBox(): OfferBox {
  instance ??= createOfferBox(sharedPool(), { profiles: getProfiles(), jobOffers: getJobOffers() });
  return instance;
}

/**
 * The Candidate's Offer box, read once per request: Recherches d'offres' title reads its count for the filter icon in the
 * Top Bar (#898), and the page lays it out (JobSearchesMenuPage).
 */
export const readOfferBox = cache((candidateId: string) => getOfferBox().read(candidateId));
