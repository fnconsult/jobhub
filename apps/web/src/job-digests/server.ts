import { notFound, redirect } from "next/navigation";
import { getApplications } from "@/applications/server";
import { getAuth, getCurrentCandidate, getMailer } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getJobOffers } from "@/job-offers/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { createJobDigests, jobDigestsConfigFromEnv, type JobDigest, type JobDigests } from "./index";

let instance: JobDigests | undefined;

/**
 * The app's Job Digests module, on the database named by DATABASE_URL. The web
 * app opts Candidates in and out and shows the Job Digests; the worker
 * (apps/worker) makes and emails them.
 */
export function getJobDigests(): JobDigests {
  instance ??= createJobDigests(sharedPool(), {
    profiles: getProfiles(),
    jobOffers: getJobOffers(),
    applications: getApplications(),
    billing: getBilling(),
    mailer: getMailer(),
    baseURL: String(getAuth().options.baseURL),
    // The Platform Settings in use (Back Office, env, default), read at each delivery.
    config: () => jobDigestsConfigFromEnv(getPlatformSettingsResolver().current().env),
  });
  return instance;
}

/**
 * For a Job Digest's page: the signed-in Candidate and their Job Digest `id`.
 * Sends anonymous visitors to sign in, and answers 404 for a Job Digest that is not theirs.
 */
export async function requireOwnJobDigest(id: string): Promise<{ candidateId: string; jobDigest: JobDigest }> {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const jobDigest = await getJobDigests().get(candidate.id, id);
  if (!jobDigest) notFound();
  return { candidateId: candidate.id, jobDigest };
}
