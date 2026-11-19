/**
 * The first welcome (#1051, decision #1043): a Candidate without any finished Profile creating one on `/profils/nouveau`.
 * On a wide screen the page opens split in two from the first question, the conversation on the left and Activité on the
 * right, never empty: the Profile in construction before it is born, then the offered Job Search's progress and its Job
 * Offers with their Match Score. On a phone there is no split: once the offered Job Search found Job Offers at the Match
 * Score threshold (FUNNEL_MATCH_SCORE) or above, a card of the first ones shows in the thread. « Ajouter un profil » (a
 * finished Profile exists, Profiles.hasFinished) keeps the page as it was.
 *
 *   firstOffers(best)                   the phone card's Job Offers: up to 3 at the threshold or above, the best first
 *   profileBuilding({ creation, … })    the Profile in construction: its CV, target role and places so far
 *
 * Pure, and safe in the browser.
 */
import { FUNNEL_MATCH_SCORE } from "@jobhub/shared";
import type { CreationGiven, EntryOffer } from "../ai-activity/entries";

/** How many Job Offers the phone's card lists. */
export const FIRST_OFFERS_SHOWN = 3;

/** The phone card's Job Offers: those at the Match Score threshold or above, the best first, 3 at most; none, no card. */
export function firstOffers(best: readonly EntryOffer[]): EntryOffer[] {
  return best
    .filter((offer) => offer.score >= FUNNEL_MATCH_SCORE)
    .sort((one, other) => other.score - one.score)
    .slice(0, FIRST_OFFERS_SHOWN);
}

/** The CV of the Profile in construction: none sent yet, being read, read, or the interview went on without one. */
export type BuildingCv = "waiting" | "reading" | "read" | "none";

/** The Profile in construction (#1051): its CV, then its target role and places as answered or validated, null and [] until then. */
export interface ProfileBuilding {
  cv: BuildingCv;
  targetRole: string | null;
  locations: string[];
}

/** What the creation page told AI Activity so far (ai-activity/creation), and whether a CV is being read there now. */
export function profileBuilding({ creation, cvReading }: { creation: CreationGiven | null; cvReading: boolean }): ProfileBuilding {
  const cv: BuildingCv = cvReading ? "reading" : creation?.reading ? "read" : creation?.interview || creation?.questionnaire ? "none" : "waiting";
  const targetRole = creation?.building?.targetRole.trim() || null;
  const locations = (creation?.building?.locations ?? []).map((place) => place.trim()).filter(Boolean);
  return { cv, targetRole, locations };
}
