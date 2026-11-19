import { leadIntoOnboarding } from "@/onboarding-arrival/server";
import { AccountProfiles } from "./profiles-section";

/**
 * /compte, where a Candidate lands once signed in: the Profiles Section. A Candidate without any Profile is led into
 * the « Entretien d'accueil » instead, until « Plus tard » (#1050); /compte/profils never leads there.
 */
export default async function AccountPage() {
  await leadIntoOnboarding();
  return <AccountProfiles />;
}
