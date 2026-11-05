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
