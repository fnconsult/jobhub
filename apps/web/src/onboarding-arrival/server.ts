import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentIsAdministrator } from "@/admin/server";
import { getCurrentSession } from "@/auth/server";
import { currentAssociationIdentity } from "@/coach-associations/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { sharedPool } from "@/database/pool";
import { currentHasHumanCoachIdentity } from "@/human-coaches/server";
import { inAppWebView } from "@/native-app/in-app";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { createOnboardingArrival, type OnboardingArrival } from "./index";

let instance: OnboardingArrival | undefined;

/** The app's arrival into the « Entretien d'accueil » (#1050), on the database named by DATABASE_URL. */
export function getOnboardingArrival(): OnboardingArrival {
  instance ??= createOnboardingArrival(sharedPool(), {
    profileCount: async (candidateId) => (await getProfiles().list(candidateId)).length,
    async hasOtherRole() {
      const roles = await Promise.all([currentHasHumanCoachIdentity(), currentIsAdministrator(), coachSpaceV2On() ? currentAssociationIdentity() : false]);
      return roles.some(Boolean);
    },
  });
  return instance;
}

/**
 * For `/` and `/compte`: sends the signed-in Candidate led into the « Entretien d'accueil » there (#1050). Never inside
 * the Jobbbox app, whose WebViews open Mon compte from its own menu and whose home has its own « Pour commencer ».
 */
export async function leadIntoOnboarding(): Promise<void> {
  const current = await getCurrentSession();
  if (!current) return;
  if (inAppWebView((await headers()).get("user-agent"))) return;
  const { session, user } = current;
  const led = await getOnboardingArrival().leadsToOnboarding({ candidateId: user.id, sessionId: session.id, postponed: session.onboardingPostponed === true });
  if (led) redirect(routes.newProfile);
}
