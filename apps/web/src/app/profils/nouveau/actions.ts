"use server";

import { redirect } from "next/navigation";
import { getCurrentSession } from "@/auth/server";
import { getOnboardingArrival } from "@/onboarding-arrival/server";
import { routes } from "@/routes";

/** « Plus tard » at the « Entretien d'accueil » (#1050): this session is no longer led there, and goes on to Mon compte. */
export async function postponeOnboarding(): Promise<void> {
  const current = await getCurrentSession();
  if (current) await getOnboardingArrival().postpone({ candidateId: current.user.id, sessionId: current.session.id });
  redirect(routes.account);
}
