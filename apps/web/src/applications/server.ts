import { notFound, redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { getCurrentCandidate } from "@/auth/server";
import { getJobOffers } from "@/job-offers/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { createApplications, type Application, type Applications } from "./index";

let instance: Applications | undefined;

/** The app's Applications module, on the database named by DATABASE_URL. */
export function getApplications(): Applications {
  instance ??= createApplications(sharedPool(), { jobOffers: getJobOffers(), profiles: getProfiles() });
  return instance;
}

/**
 * For an Application's page: the signed-in Candidate and their Application `id`.
 * Sends anonymous visitors to sign in, and answers 404 for an Application that is not theirs.
 */
export async function requireOwnApplication(id: string): Promise<{ candidateId: string; application: Application }> {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const application = await getApplications().get(candidate.id, id);
  if (!application) notFound();
  return { candidateId: candidate.id, application };
}
