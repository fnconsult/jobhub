import { notFound, redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { getJobOffers } from "@/job-offers/server";
import { getJobQueue } from "@/job-queue/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { createJobSearches, type JobSearch, type JobSearches } from "./index";

let instance: JobSearches | undefined;

/** The app's Job Searches module, on the database named by DATABASE_URL and the worker's queue. */
export function getJobSearches(): JobSearches {
  instance ??= createJobSearches(sharedPool(), {
    profiles: getProfiles(),
    jobOffers: getJobOffers(),
    applications: getApplications(),
    quotas: getBilling(),
    queue: getJobQueue(),
  });
  return instance;
}

/**
 * For a Job Search's page: the signed-in Candidate and their Job Search `id`.
 * Sends anonymous visitors to sign in, and answers 404 for a Job Search that is not theirs.
 */
export async function requireOwnJobSearch(id: string): Promise<{ candidateId: string; jobSearch: JobSearch }> {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const jobSearch = await getJobSearches().get(candidate.id, id);
  if (!jobSearch) notFound();
  return { candidateId: candidate.id, jobSearch };
}
